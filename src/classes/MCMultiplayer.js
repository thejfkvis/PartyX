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

    async #req({ endpoint, method = "POST", body = null, version = "1.26.21", extraHeaders = {} }) {
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
            return text ? JSON.parse(text) : { success: response.ok };
        } catch (e) {
            return text;
        }
    }

    async getParty(partyId, playfabId, clientVersion = "1.26.21") {
        return this.#req({
            endpoint: `/party/${partyId}/invite/${playfabId}`,
            method: "GET",
            version: clientVersion
        });
    }

    async createParty(clientVersion = "1.26.21", privacy = "closed", restrictInvitesToLeader = false) {
        return this.#req({
            endpoint: "/party/create",
            version: clientVersion,
            body: {
                memberData: { clientVersion },
                privacy,
                restrictInvitesToLeader
            }
        });
    }

    async invitePlayerToParty(partyId, playerId, clientVersion = "1.26.21") {
        const xboxToken = await this.getXboxAuthToken()
        if (typeof xboxToken === "object" && xboxToken.errorMsg) throw new Error(xboxToken.errorMsg);

        return await this.#req({
            endpoint: `/party/${partyId}/invite`,
            version: clientVersion,
            body: { playerId, xboxToken }
        });
    }

    async findParties(clientVersion = "1.26.21") {
        const xboxToken = await this.getXboxAuthToken("https://b980a380.minecraft.playfabapi.com/")
        if (typeof xboxToken === "object" && xboxToken.errorMsg) throw new Error(xboxToken.errorMsg);

        return this.#req({
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
        return this.#req({
            endpoint: `/party/${partyId}/leave`,
            method: "POST"
        });
    }

    async ignoreInvite(partyId) {
        return this.#req({
            endpoint: `/party/${partyId}/ignore`,
            method: "POST"
        });
    }
}

module.exports = MCMultiplayerAPI;