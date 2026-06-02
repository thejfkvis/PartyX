const XboxAPI = require("./Xbox.js");

class PlayFabAPI extends XboxAPI {
    constructor(options) {
        super(options);
        this.options = options;
        this.pfUrl = "https://20ca2.playfabapi.com";
        this.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "libHttpclient/1.0.0.0",
            "Accept-Language": "en-US",
            "Host": "20ca2.playfabapi.com",
            "Connection": "Keep-Alive",
            "Cache-Control": "no-cache",
            'X-PlayFabSDK': 'PlayFabMultiplayerSDK.WinGameCore-1.8.0'
        }
    }

    async #req(endpoint, body = null, extraHeaders = {}) {
        const url = `${this.pfUrl}${endpoint}`;

        if (!body?.CreateAccount || extraHeaders["x-entitytoken"]) {
            this.auth = await this.loginWithXbox();
            if (this.auth.errorMsg) return this.auth;

            extraHeaders["x-authorization"] = this.auth.SessionTicket;
        }

        const headers = { ...this.headers, ...extraHeaders }
        let bodyStr

        if (body) {
            headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body)).toString();
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        const data = await response.json();

        if (response.status !== 200) {
            return { errorMsg: `[${endpoint}] ${data.code || 'Unknown'} ${data.status}. Error: ${data.errorMessage || 'No error message'}` }
        }

        return data.data || data;
    }

    async loginWithXbox() {
        const xboxToken = await this.getXboxAuthToken("https://b980a380.minecraft.playfabapi.com/");

        if (!xboxToken || xboxToken.errorMsg) return xboxToken;

        const body = {
            CreateAccount: true,
            InfoRequestParameters: {
                GetPlayerProfile: true,
                GetUserAccountInfo: true
            },
            TitleId: "20CA2",
            XboxToken: xboxToken
        }

        return this.#req("/Client/LoginWithXbox", body);
    }

    async getLobby(LobbyId) {
        const authData = await this.loginWithXbox();

        if (authData.errorMsg) return authData;

        const body = { LobbyId }

        return await this.#req("/Lobby/GetLobby", body, {
            'X-EntityToken': authData.EntityToken.EntityToken
        })
    }

    async findLobbies(LobbyId) {
        const authData = await this.loginWithXbox();

        if (authData.errorMsg) return authData;

        return await this.#req("/Lobby/FindLobbies", null, {
            'X-EntityToken': authData.EntityToken.EntityToken
        })
    }

    async subscribeToLobbyResource(Type, ResourceId, pubSubConnectionHandle) {
        const authData = await this.loginWithXbox();

        if (authData.errorMsg) return authData;

        const body = {
            EntityKey: {
                Id: authData.EntityToken.Entity.Id,
                Type: 'title_player_account'
            },
            ResourceId,
            SubscriptionVersion: 1,
            // LobbyInvite
            // LobbyChange
            Type,
            pubSubConnectionHandle
        }

        return await this.#req("/Lobby/SubscribeToLobbyResource", body, {
            'X-EntityToken': authData.EntityToken.EntityToken
        })
    }

    async getPubSubBearerToken() {
        const authData = await this.loginWithXbox();

        if (authData.errorMsg) return authData;

        return await this.#req("/pubsub/negotiate?negotiateVersion=1", null, {
            'X-EntityToken': authData.EntityToken.EntityToken
        })
    }
}

module.exports = PlayFabAPI;