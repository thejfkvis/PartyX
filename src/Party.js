const { EventEmitter } = require("node:events");
const { createRTC } = require("./classes/RTC");
const { Version } = require("./Constants")

const MCMultiplayerAPI = require("./classes/MCMultiplayer");
const PubSubAPI = require("./classes/PubSub");
const JSONRPC = require("./classes/JSONRPC");

class Party extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            clientVersion: Version,
            privacy: "closed",
            restrictInvitesToLeader: false,
            autoConnectRPC: true,
            inviteTimeout: 60000,
            waitForInvite: false,
            joinManually: false,
            ...options,
        };

        this.MCMAPI = new MCMultiplayerAPI(this.options);
        this.PUBAPI = new PubSubAPI(this.options);

        this.party = null;
        this.pub = null;
        this.rpc = null;
        this.rtc = null;
        this.initialized = false;
        this.members = new Map();
        this.changeNumber = 0;

        this._setupExitHandlers();
    }

    _setupExitHandlers() {
        const cleanup = async () => {
            if (this.party?.id) {
                console.log("\n[Party] Clean exit: Leaving party...");
                try {
                    await this.leaveParty();
                    clearInterval(this.presenceInterval)
                } catch (e) {
                    console.error("[Party] Error occurred while leaving party:", e);
                }
            }
        };

        process.on("SIGINT", async () => {
            await cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", async () => {
            await cleanup();
            process.exit(0);
        });

        process.once("uncaughtException", async (err) => {
            console.error("[Party] Uncaught Exception:", err);
            await cleanup();
            process.exit(1);
        });
    }

    async waitForInvite(timeoutMs = this.options.inviteTimeout || 60000) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timed out waiting for a party invite."));
            }, timeoutMs);

            const listener = (msg) => {
                try {
                    const payloadString = Buffer.from(msg.payload).toString("utf8");
                    const data = JSON.parse(payloadString);

                    if (data.lobbyId || msg.topic.includes("LobbyInvite")) {
                        clearTimeout(timeout);

                        resolve(data);
                    }
                } catch (e) {
                    throw new Error("Failed to parse PubSub message while waiting for invite: " + e.message);
                }
            };

            this.pub.ws.on("ReceiveMessage", listener);
        });
    }

    async init() {
        if (this.initialized) return this;

        this.pub = await this.getPubSubConnectionHandle();
        if (!this.pub?.connectionHandle) throw new Error("Failed to retrieve PubSub connection handle");

        this.pub.ws.on("ReceiveMessage", async (msg) => {
            const payloadString = Buffer.from(msg.payload).toString("utf8");
            const data = JSON.parse(payloadString);

            if (msg.topic.includes("LobbyChange")) {
                for (const change of data.lobbyChanges) {
                    this.changeNumber = change.changeNumber;

                    const { memberToDelete, memberToMerge } = change;

                    const delId = memberToDelete?.memberEntity?.Id;

                    if (delId && this.members.delete(delId)) {
                        this.emit("leave", memberToDelete);

                        continue;
                    }

                    const updId = memberToMerge?.memberEntity?.Id;

                    if (updId) {
                        const eMember = this.members.get(updId);

                        if (eMember) {
                            Object.assign(eMember, memberToMerge);
                        } else {
                            this.members.set(updId, memberToMerge);

                            if (memberToMerge.memberData) {
                                const profile = await this.MCMAPI.getXboxUser(memberToMerge.memberData.Xuid);
                                memberToMerge.memberData.XblName = profile.gamertag;
                            } else {
                                continue
                            }

                            this.emit("join", memberToMerge);
                        }
                    }
                }
            }

            this.emit("ReceiveMessage_Pub", { topic: msg.topic, ...data });
        });

        this.pub.ws.on("ReceiveSubscriptionChangeMessage", (msg) => {
            if (msg.topic.includes(this.party.id)) {
                switch (msg.status) {
                    case "UnsubscribeSuccess":
                        this.leaveParty(msg.unsubscribeReason)
                        break;
                }

                this.emit("ReceiveSubscriptionChangeMessage_Pub", msg)
            }
        })

        await this.subscribeToLobbyResource("LobbyInvite", "@me", this.pub.connectionHandle);

        let party, partyId;

        if (this.options.joinManually) return this;

        if (this.options.waitForInvite) {
            console.log("Waiting for a lobby invite...");

            let partyData = await this.waitForInvite();
            partyId = partyData.lobbyId;

            const invite = await this.MCMAPI.acceptInvite(partyData.lobbyId, partyData.connectionString);

            if (!invite?.result?.id) throw new Error("Could not determine Party ID from invite");

            const lobbyData = await this.getLobby(invite.result.id);

            party = lobbyData.Lobby
        } else {
            let lobbyData = await this.createParty(this.options.clientVersion, this.options.privacy, this.options.restrictInvitesToLeader);

            lobbyData = await this.getLobby(lobbyData.result.id)

            party = lobbyData.Lobby
        }

        this.changeNumber = party.ChangeNumber;

        if (party.LobbyId) await this.completeInit(party)

        return this;
    }

    async completeInit(party) {
        if (party.LobbyId) party.id = party.LobbyId;
        if (!party.id) throw new Error("Could not determine Party ID");

        this.party = party;

        for (const member of party.Members) {
            if (member.MemberData.Xuid) {
                const profile = await this.MCMAPI.getXboxUser(member.MemberData.Xuid);
                member.MemberData.XblName = profile.gamertag;
            }

            const emptyPubSub = member.PubSubConnectionHandle.length === 0;

            // Do lowercase versions as we want this accurate as possible to whenever it's done by the PubSub connection.
            this.members.set(member.MemberEntity.Id, {
                memberData: member.MemberData,
                memberEntity: {
                    Type: member.MemberEntity.Type,
                    Id: member.MemberEntity.Id
                },
                // If it's empty then it's probably us twin, dont lie
                pubSubConnectionHandle: emptyPubSub ? this.pub.connectionHandle : member.PubSubConnectionHandle
            })
        }

        await this.subscribeToLobbyResource("LobbyChange", party.id, this.pub.connectionHandle);

        if (this.options.autoConnectRPC) await this.connectRPC(party.id, this.options.clientVersion);

        this.initialized = true;
        this.emit("ready", { partyId: party.id, party });

        this.updatePresence({});

        this.presenceInterval = (() => {
            this.updatePresence({});
        }, 60000)

        return this.party;
    }

    async updatePresence() {
        return await this.MCMAPI.sendPresence({})
    }

    async findParties() {
        const lobbies = await this.MCMAPI.findParties();
        if (!lobbies?.result) throw new Error("Failed to retrieve lobbies");
        return lobbies.result;
    }

    async createParty(version = this.options.clientVersion, privacy = this.options.privacy, restrict = this.options.restrictInvitesToLeader) {
        const party = await this.MCMAPI.createParty(version, privacy, restrict);
        if (party?.result?.id) this.party = party;
        return party;
    }

    async joinParty(partyId, version = this.options.clientVersion) {
        const party = await this.MCMAPI.joinParty(partyId, version);
        if (party?.result?.id) this.party = party;
        return party;
    }

    async getPubSubConnectionHandle() {
        const handle = await this.PUBAPI.getPubSubConnectionHandle();
        if (handle?.connectionHandle) this.pub = handle;
        return handle;
    }

    async subscribeToLobbyResource(type, resourceId, connectionHandle) {
        return this.MCMAPI.subscribeToLobbyResource(type, resourceId, connectionHandle);
    }

    async getLobby(partyId) {
        const lobby = await this.MCMAPI.getLobby(partyId);
        if (lobby?.result) this.party = lobby;
        return lobby;
    }

    async addUser(xuid) {
        return this.MCMAPI.addUser(xuid);
    }

    async invitePlayer(playerId, clientVersion = this.options.clientVersion) {
        if (!this.party?.id) throw new Error("No active party to invite to");
        return this.MCMAPI.invitePlayerToParty(this.party.id, playerId, clientVersion);
    }

    async leaveParty(reason = "Client disconnect") {
        if (!this.party?.id) return;

        const partyId = this.party.id;
        try {
            if (this.rtc?.close) this.rtc.close();

            const res = await this.MCMAPI.leaveParty(partyId);
            this.party = null;
            this.rpc.destroy(false)
            this.rpc = null;
            this.rtc = null;
            this.initialized = false;
            this.members = null;
            this.changeNumber = 0;

            this.emit("disconnect", reason);

            return res;
        } catch (error) {
            this.emit("error", new Error("Error while leaving party: " + error.message));
        }
    }

    async sendChat(message) {
        if (!this.rpc) throw new Error("RPC not connected");
        return this.rpc.write("PartyChat_SendChat_v1_0", { partyId: this.party.id, message });
    }

    async setLeader(playerId) {
        if (!this.party.id) throw new Error("No Party ID found. Did you create a party?")

        return await this.MCMAPI.setLeader(this.party.id, playerId)
    }

    async kick(playerId, preventRejoin = false) {
        if (!this.party.id) throw new Error("No Party ID found. Did you create a party?")

        return await this.MCMAPI.removePlayer(this.party.id, playerId, preventRejoin)
    }

    async setDestination(type, params) {
        if (!this.party.id) throw new Error("No Party ID found. Did you create a party?")

        return await this.MCMAPI.manageDestination(this.party.id, "POST", type, params)
    }

    async deleteDestination(type) {
        if (!this.party.id) throw new Error("No Party ID found. Did you create a party?")

        return await this.MCMAPI.manageDestination(this.party.id, "DELETE", type, {})
    }

    async connectRPC(partyId = this.party?.id, version = this.options.clientVersion) {
        if (!partyId) throw new Error("Missing party id for RPC connection");

        const rpc = new JSONRPC(partyId, this.MCMAPI.flow, version);
        this.rpc = rpc;

        rpc.on("credentials", async (credentials) => {
            try {
                this.rtc = await createRTC(credentials);
                this.emit("connected", this.rtc);
            } catch (err) {
                this.emit("error", new Error("Failed to create RTC context"));
            }
            this.emit("credentials", credentials);
        });

        const eventsToForward = ["message", "PartyChat_ReceiveChat_v1_0"];
        eventsToForward.forEach((evt) => {
            rpc.on(evt, (data) => this.emit(evt, data));
        });

        await rpc.connect();
        return rpc;
    }
}

module.exports = Party;
