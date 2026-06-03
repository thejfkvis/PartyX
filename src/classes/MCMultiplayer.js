const { Version } = require("../Constants.js")

const PlayFabAPI = require("./PlayFab.js");

class MCMultiplayerAPI extends PlayFabAPI {
    constructor(options) {
        super(options);
        this.options = options;
        this.apiUrl = "https://secondary.multiplayer.minecraft-services.net/api/v1.0";
        this.defaultHeaders = {
            "User-Agent": "libhttpclient/1.0.0.0",
            Accept: "application/json",
            Connection: "Keep-Alive",
            "Cache-Control": "no-cache",
            "session-id": crypto.randomUUID(),
        };
    }

    async #req({ endpoint, method = "POST", body = null, version = Version, extraHeaders = {} }) {
        const mcToken = await this.getMinecraftBedrockServicesToken(version);
        if (!mcToken) throw new Error("Failed to retrieve Minecraft token.");

        const url = `${this.apiUrl}${endpoint}`;
        const headers = {
            ...this.defaultHeaders,
            Authorization: mcToken,
            ...extraHeaders,
        };

        const options = { method, headers };

        if (body) {
            const bodyStr = typeof body === "string" ? body : JSON.stringify(body);

            options.body = bodyStr;
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = bodyStr.length;
        }

        const response = await fetch(url, options);
        const text = await response.text();

        try {
            return text ? JSON.parse(text) : text
        } catch (e) {
            return text;
        }
    }

    async getParty(partyId, playfabId, clientVersion = Version) {
        return await this.#req({
            endpoint: `/party/${partyId}/invite/${playfabId}`,
            method: "GET",
            version: clientVersion
        });
    }

    async createParty(clientVersion = Version, privacy = "closed", restrictInvitesToLeader = false) {
        return await this.#req({
            endpoint: "/party/create",
            version: clientVersion,
            body: {
                memberData: { clientVersion },
                privacy,
                restrictInvitesToLeader
            }
        });
    }

    async joinParty(partyId, clientVersion = Version) {
        const xboxToken = await this.getXboxAuthToken()
        if (typeof xboxToken === "object" && xboxToken.errorMsg) throw new Error(xboxToken.errorMsg);

        const body = {
            xboxToken,
            memberData: { clientVersion }
        };

        return await this.#req({
            endpoint: `/party/${partyId}/join`,
            method: "POST",
            body
        });
    }

    async invitePlayerToParty(partyId, playerId, clientVersion = Version) {
        const xboxToken = await this.getXboxAuthToken()
        if (typeof xboxToken === "object" && xboxToken.errorMsg) throw new Error(xboxToken.errorMsg);

        return await this.#req({
            endpoint: `/party/${partyId}/invite`,
            version: clientVersion,
            body: { playerId, xboxToken }
        });
    }

    async findParties(clientVersion = Version) {
        const xboxToken = await this.getXboxAuthToken("http://playfab.xboxlive.com/")
        if (typeof xboxToken === "object" && xboxToken.errorMsg) throw new Error(xboxToken.errorMsg);

        return await this.#req({
            endpoint: "/party/findJoinable",
            version: clientVersion,
            extraHeaders: { "Accept-Encoding": "gzip" },
            body: {
                includeFullParties: true,
                maxResults: 50,
                xboxToken
            }
        });
    }

    async leaveParty(partyId) {
        return await this.#req({
            endpoint: `/party/${partyId}/leave`,
            method: "POST"
        });
    }

    async acceptInvite(partyId, connectionString, clientVersion = Version) {
        const body = {
            connectionString,
            memberData: { clientVersion }
        };

        return await this.#req({
            endpoint: `/party/${partyId}/invite/accept`,
            method: "POST",
            body
        });
    }

    async ignoreInvite(partyId) {
        return await this.#req({
            endpoint: `/party/${partyId}/invite/ignore`,
            method: "POST"
        });
    }

    async manageDestination(partyId, method = "POST", type = "gathering", options = {}) {
        if (!partyId) throw new Error("Party ID is required to manage destination");

        const destinationType = type.toLowerCase();

        const defaults = {
            p2p: {
                destinationScanText: "Minecraft World",
                xblSessionHandleId: "0"
            },
            realms: {
                destinationScanText: "Minecraft Realm",
                realmId: "0"
            },
            gathering: {
                destinationInfo: {
                    creatorId: "",
                    experienceId: "",
                    experienceName: "Experience Name",
                    scenarioId: "",
                    serverId: "",
                    targetId: "",
                    worldId: "",
                    worldName: "World Name"
                }
            }
        };

        let body;

        switch (destinationType) {
            case "p2p":
                 body = {
                    ...defaults.p2p,
                    ...options
                }
                break;
            case "realms":
                body = {
                    ...defaults.realms,
                    ...options
                }
                break
            case "gathering":
                body = {
                    destinationInfo: {
                        ...defaults.gathering.destinationInfo,
                        ...(options.destinationInfo || options)
                    }
                }
                break;
            default:
                body = options;
                break;
        }

        return await this.#req({
            endpoint: `/party/${partyId}/destination/${destinationType}`,
            method: method.toUpperCase(),
            body: method.toUpperCase() === "DELETE" ? null : body
        });
    }

    async joinExperience(partyId) {
        return await this.#req({
            endpoint: `/join/experience/${partyId}`,
            method: "POST",
            apiVersion: "2.0"
        });
    }

    async setLeader(partyId, playerId) {
        return await this.#req({
            endpoint: `/party/${partyId}/setLeader`,
            body: { playerId }
        });
    }

    async removePlayer(partyId, playerId, preventRejoin = false) {
         return await this.#req({
            endpoint: `/party/${partyId}/remove`,
            body: { playerId, preventRejoin }
        });
    }
}

module.exports = MCMultiplayerAPI;