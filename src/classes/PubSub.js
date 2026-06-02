const { v4fast } = require("uuid-1345");
const crypto = require("crypto");
const PlayFabAPI = require("./PlayFab.js");
const signalR = require("@microsoft/signalr");
const msgpack = require("@microsoft/signalr-protocol-msgpack");

class PubSubAPI extends PlayFabAPI {
    constructor(options) {
        super(options);
        this.options = options;
        this.apiUrl = "";
        this.defaultHeaders = {
            "User-Agent": "libHttpclient/1.0.0.0",
            Accept: "application/json",
            Connection: "Keep-Alive",
            "Cache-Control": "no-cache",
            'X-PlayFabSDK': 'PlayFabMultiplayerSDK.WinGameCore-1.8.0'
        };
    }

    async #req({ endpoint, method = "POST", body = null, version = "1.26.21", extraHeaders = {} }) {
        const url = `${this.apiUrl}${endpoint}`;
        const headers = {
            ...this.defaultHeaders,
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

    async createWebSocket(data, bearer, authData) {
        const urlWithId = `${this.apiUrl}/client/?hub=pubsubhub&id=${encodeURIComponent(data.connectionToken)}`;

        const connection = new signalR.HubConnectionBuilder()
            .withUrl(urlWithId, {
                transport: signalR.HttpTransportType.WebSockets,
                skipNegotiation: true,
                accessTokenFactory: () => bearer.accessToken,
                headers: {
                    ...this.defaultHeaders,
                    "X-EntityToken": authData.EntityToken.EntityToken,
                    "User-Agent": "libHttpclient/1.0.0.0"
                }
            })
            .withAutomaticReconnect()
            .withHubProtocol(new msgpack.MessagePackHubProtocol())
            .build();

        connection.serverTimeoutInMilliseconds = 30000;
        connection.keepAliveIntervalInMilliseconds = 5000;

        try {
            await connection.start();
            const sessionId = v4fast();
            const match = bearer.url.match(/pubsub-(.*?)\.service/);
            const extracted = match ? match[1] : "";

            const request = {
                SessionId: v4fast(),
                TraceParent: `00-${crypto.randomBytes(32).toString("hex")}-${crypto.randomBytes(16).toString("hex")}-00`
            };

            const session = await connection.invoke("StartOrRecoverSession", request);

            return { connection, connectionHandle: session.newConnectionHandle };
        } catch (err) {
            console.error(err);

            return { errorMsg: "Failed to establish WebSocket connection" };
        }
    }

    async getPubSubConnectionHandle() {
        const authData = await this.loginWithXbox();
        if (authData.errorMsg) return authData;

        const bearer = await this.getPubSubBearerToken();
        if (bearer.errorMsg) return bearer;

        const urlObj = new URL(bearer.url);
        this.apiUrl = urlObj.origin;

        const query = urlObj.search + "&negotiateVersion=1";

        const resp = await this.#req({
            "endpoint": "/client/negotiate" + query,
            "body": null,
            "method": "POST",
            "extraHeaders": {
                "Authorization": "Bearer " + bearer.accessToken,
                'X-EntityToken': authData.EntityToken.EntityToken
            }
        });

        if (!resp.connectionId) return resp;

        const ws = await this.createWebSocket(resp, bearer, authData);

        return {
            connectionHandle: ws.connectionHandle,
            ws
        }
    }
}

module.exports = PubSubAPI;