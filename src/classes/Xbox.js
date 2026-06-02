const { Authflow, Titles } = require("prismarine-auth");

class XboxAPI {
    constructor(options) {
        this.options = options

        if (!this?.options?.authflow) {
            this.flow = new Authflow(undefined, this.options.authFolder ?? "./auth", {
                flow: this.options.flow ?? "sisu",
                authTitle: this.options.authTitle ?? Titles.MinecraftNintendoSwitch,
                deviceType: this.options.deviceType ?? "Nintendo",
                deviceVersion: this.options.deviceVersion ?? "0.0.0"
            });
        }
    }

    async getXboxAuthToken(relyingParty = "http://xboxlive.com") {
        this.flow = this.options.authflow || new Authflow(undefined, this.options.authFolder ?? "./auth", {
            flow: this.options.flow ?? "sisu",
            authTitle: this.options.authTitle ?? Titles.MinecraftNintendoSwitch,
            deviceType: this.options.deviceType ?? "Nintendo",
            deviceVersion: this.options.deviceVersion ?? "0.0.0"
        });

        let xboxToken;
        try {
            xboxToken = await this.flow.getXboxToken(relyingParty);
        } catch (e) {
            console.error(e);
        }

        if (!xboxToken) throw new Error("Failed to retrieve Xbox token.");

        if (typeof xboxToken.userXUID === "string") {
            this.xuid = xboxToken.userXUID;
        }

        return `XBL3.0 x=${xboxToken.userHash};${xboxToken.XSTSToken}`;
    }

    async getMinecraftBedrockServicesToken(version = "1.26.21") {
        const authToken = await this.getXboxAuthToken();

        if (typeof authToken === "object" && authToken.errorMsg) return authToken;

        const result = await this.flow.getMinecraftBedrockServicesToken({ version });

        if (!result.mcToken) throw new Error("Failed to retrieve Minecraft token.");

        return result.mcToken;
    }

    async #req(url = "", options = {}, config = { relyingParty: "http://xboxlive.com" }, contextName = "request") {
        if (url.length === 0) return { errorMsg: "No URL provided." }

        const authToken = await this.getXboxAuthToken(config.relyingParty);

        if (typeof authToken === "object" && authToken.errorMsg) throw new Error(`Login failed: ${authToken.errorMsg}`);

        const dHeaders = {
            "Accept-Language": "en-US",
            "Authorization": authToken,
            "x-xbl-contract-version": "2",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "Keep-Alive",
            "Cache-Control": "no-cache"
        }

        const fOptions = {
            ...options,
            headers: {
                ...dHeaders,
                ...options.headers
            }
        }

        if (fOptions.body && typeof fOptions.body === "object") {
            fOptions.body = JSON.stringify(fOptions.body);

            if (!fOptions.headers["Content-Type"]) fOptions.headers["Content-Type"] = "application/json";
            fOptions.headers["content-length"] = fOptions.body.length;
        }

        try {
            const response = await fetch(url, fOptions);

            if (response.ok || [200, 204, 403].includes(response.status)) {
                const contentType = response.headers.get("content-type");

                if (contentType && contentType.includes("application/json")) {
                    const json = await response.json();

                    return { data: json, status: response.status }
                }

                if (response.status === 204) return { data: null, status: 204 }

                return { data: await response.text(), status: response.status }
            }

            return { errorMsg: await response.text(), status: response.status }
        } catch (error) {
            return { errorMsg: error.message || "Network error", status: 0 }
        }
    }

    async gamertagToXuid(gamertag = "") {
        if (typeof gamertag != "string" || gamertag.length === 0) throw new Error("No gamertag provided");

        const result = await this.#req(`https://profile.xboxlive.com/users/gt(${gamertag})/profile/settings`, {
            method: "GET",
            headers: {
                "Accept": "application/json; charset=utf-8",
                "User-Agent": "XboxServicesAPI/2021.10.20220301.4 c",
                "x-xbl-contract-version": 2,
                "Host": "profile.xboxlive.com"
            }
        });

        return result.status === 200 ? result.data?.profileUsers?.[0]?.id || null : null;
    }

    async getXboxUser(xuid = "") {
        await this.getXboxAuthToken();

        if (!xuid) xuid = this.xuid;
        if (!xuid || typeof xuid != "string" || xuid.length === 0) throw new Error("No XUID provided");

        const result = await this.#req(`https://peoplehub.xboxlive.com/users/me/people/xuids(${xuid})/decoration/detail,preferredColor,presenceDetail`, {
            method: "GET",
            headers: {
                "x-xbl-contract-version": 4,
                "Accept": "application/json",
                "User-Agent": "WindowsGameBar/5.823.1271.0",
                "Host": "peoplehub.xboxlive.com"
            }
        });

        return result.status === 200 ? result.data?.people?.[0] || [] : result;
    }

    async getXboxUserBulk(xuids = []) {
        if (xuids.length === 0) return [];

        const result = await this.#req("https://peoplehub.xboxlive.com/users/me/people/batch/decoration/detail,presenceDetail", {
            method: "POST",
            headers: {
                "x-xbl-contract-version": 4,
                "Accept": "application/json",
                "User-Agent": "WindowsGameBar/5.823.1271.0",
                "Host": "peoplehub.xboxlive.com"
            },
            body: { xuids }
        });

        return result.status === 200 ? result.data?.people || [] : result;
    }

    async addUser(XUID = "") {
        if (typeof XUID != "string" || XUID.length === 0) return;

        const result = await this.#req(`https://social.xboxlive.com/users/me/people/friends/v2/xuid(${XUID})`, {
            method: "PUT",
            headers: {
                "User-Agent": "WindowsGameBar/5.823.1271.0",
                "x-xbl-contract-version": 3,
                "Host": "social.xboxlive.com"
            }
        });

        return result.status === 200 ? { data: "success", status: 200 } : result;
    }

    async removeUser(XUID = "") {
        if (typeof XUID != "string" || XUID.length === 0) return;

        const result = await this.#req(`https://social.xboxlive.com/users/me/people/friends/v2/xuid(${XUID})?deleteRelationships=friends`, {
            method: "DELETE",
            headers: {
                "User-Agent": "WindowsGameBar/5.823.1271.0",
                "x-xbl-contract-version": 3,
                "Host": "social.xboxlive.com"
            }
        });

        return result.status === 200 ? { data: "success", status: 200 } : result;
    }

    async followUser(XUID = "") {
        if (typeof XUID != "string" || XUID.length === 0) return;

        const result = await this.#req(`https://social.xboxlive.com/users/xuid(${this.xuid})/people/xuid(${XUID})`, {
            method: "PUT",
            headers: {
                "x-xbl-contract-version": 3,
                "Host": "social.xboxlive.com"
            },
        });

        return result.status === 204 ? { data: "success", status: 204 } : result;
    }
}

module.exports = XboxAPI;