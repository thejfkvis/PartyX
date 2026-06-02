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
            ...options,
        };

        this.MCMAPI = new MCMultiplayerAPI(this.options);
        this.PUBAPI = new PubSubAPI(this.options);

        this.party = null;
        this.pub = null;
        this.rpc = null;
        this.rtc = null;
        this.initialized = false;

        this._setupExitHandlers();
    }

    _setupExitHandlers() {
        const cleanup = async () => {
            if (this.party?.id) {

                console.log("\n[Party] Clean exit: Leaving party...");
                try {
                    await this.leaveParty();
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

        try {
            this.pub = await this.getPubSubConnectionHandle();
            if (!this.pub?.connectionHandle) throw new Error("Failed to retrieve PubSub connection handle");

            this.pub.ws.on("ReceiveMessage", (msg) => {;
                this.emit("pubsub_message", msg);
            });

            await this.subscribeToLobbyResource("LobbyInvite", "@me", this.pub.connectionHandle);

            let partyId;

            if (this.options.waitForInvite) {
                console.log("Waiting for a lobby invite...");

                let partyData = await this.waitForInvite();
                partyId = partyData.lobbyId;

                const invite = await this.MCMAPI.acceptInvite(partyData.lobbyId, partyData.connectionString);

                if (!invite?.result?.id) throw new Error("Could not determine Party ID from invite");

                const lobbyData = await this.getLobby(invite.result.id);

                this.party = lobbyData.Lobby
            } else {
                const lobbyData = await this.createParty(this.options.clientVersion, this.options.privacy, this.options.restrictInvitesToLeader);

                this.party = lobbyData.result

                partyId = this.party?.id;
            }

            if (!partyId) throw new Error("Could not determine Party ID");

            await this.subscribeToLobbyResource("LobbyChange", partyId, this.pub.connectionHandle);

            if (this.options.autoConnectRPC) await this.connectRPC(partyId, this.options.clientVersion);

            this.initialized = true;
            this.emit("ready", { partyId, party: this.party });
            return this;
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }

    async findParties() {
        const lobbies = await this.MCMAPI.findLobbies();
        if (!lobbies?.result?.Lobbies) throw new Error("Failed to retrieve lobbies");
        return lobbies.result.Lobbies;
    }

    async createParty(version = this.options.clientVersion, privacy = this.options.privacy, restrict = this.options.restrictInvitesToLeader) {
        const party = await this.MCMAPI.createParty(version, privacy, restrict);
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

    async leaveParty() {
        if (!this.party?.id) return;

        const partyId = this.party.id;
        try {
            if (this.rtc?.close) this.rtc.close();

            const res = await this.MCMAPI.leaveParty(partyId);
            this.party = null;
            this.rpc = null;
            this.rtc = null;
            this.initialized = false;

            this.emit("left");
            return res;
        } catch (error) {
            this.emit("error", new Error("Error while leaving party: " + error.message));
        }
    }

    async sendChat(message) {
        if (!this.rpc) throw new Error("RPC not connected");
        return this.rpc.send("PartyChat_SendChat_v1_0", { message });
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