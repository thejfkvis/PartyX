const { EventEmitter, once } = require('node:events')
const { WebSocket } = require('ws')
const { v4fast: v4 } = require("uuid-1345")

class JSONRPC extends EventEmitter {
    constructor(partyId, authflow, version) {
        super()
        this.partyId = partyId
        this.authflow = authflow
        this.version = version
        this.ws = null
        this.credentials = []
        this.candidates = []

        this.pingInterval = null
        this.retryCount = 0
        this.destroyed = false
        this.lastLiveness = 0
        this.maxRetries = 5
    }

    async connect() {
        if (this.ws?.readyState === WebSocket.OPEN) throw new Error('Already connected signaling server');
        this.destroyed = false

        await this.init()
        await Promise.race([
            once(this, "credentials"),
            new Promise((_, reject) => setTimeout(() => reject(), 15000))
        ])
    }

    async destroy(resume = false) {
        this.destroyed = !resume

        if (this.pingInterval) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }

        const ws = this.ws
        this.ws = null

        if (ws) {
            ws.removeAllListeners("open")
            ws.removeAllListeners("close")
            ws.removeAllListeners("error")
            ws.removeAllListeners("message")

            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                await new Promise((resolve) => {
                    const done = () => resolve()

                    ws.once("close", done)

                    try {
                        ws.close(1000, "Normal Closure")
                    } catch {
                        resolve()
                    }
                })
            }
        }

        if (resume) return this.reconnectWithBackoff()
    }

    async reconnectWithBackoff() {
        if (this.retryCount >= this.maxRetries) {
            this.emit("error", new Error("Signal reconnection failed after max retries"));
            return;
        }

        await new Promise((r) => setTimeout(r, 15000));

        try {
            await this.init();
        } catch (e) { }
    }

    async init() {
        const pfb = await this.authflow.getPlayfabLogin().catch(e => {
            throw e
        })

        const xbl = await this.authflow.getMinecraftBedrockServicesToken({ version: this.version }).catch(e => {
            throw e
        })

        const address = `https://signal.franchise.minecraft-services.net/ws/v1.0/messaging/connect`;

        if (typeof xbl?.mcToken != "string") {
            throw new Error("Failed to obtain Minecraft Services token for signaling connection")
        }

        try {
            const ws = new WebSocket(address, { headers: { Authorization: xbl.mcToken, "session-id": v4(), "request-id": v4() } })
            this.ws = ws
            this.lastLiveness = Date.now()

            ws.on("open", () => this.onOpen())
            ws.on("close", (code, reason) => this.onClose(code, reason.toString()))
            ws.on("error", (err) => this.onError(err))
            ws.on("message", (data) => this.onMessage(data))

            if (!this.pingInterval) {
                this.pingInterval = setInterval(() => {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

                    this.ws.send(JSON.stringify({ params: {}, jsonrpc: "2.0", method: "System_Ping_v1_0", id: v4() }))

                    if (Date.now() - this.lastLiveness > 60000) {
                        try {
                            this.ws.terminate?.()
                        } catch { }
                    }
                }, 30000)
            }
        } catch (error) {
            this.emit("error", error)
        }
    }

    onOpen() {
        this.retryCount = 0
        this.lastLiveness = Date.now()
        this.ws.send(JSON.stringify({
            params: {},
            jsonrpc: "2.0",
            method: "Signaling_TurnAuth_v1_0",
            id: v4()
        }))
        this.ws.send(JSON.stringify({
            params: {
                partyId: this.partyId
            },
            jsonrpc: "2.0",
            method: "PartyChat_JoinParty_v1_0",
            id: v4()
        }))
    }

    onError(err) {
        console.error(err);
        this.client.emit("error", `Signaling WebSocket error`)
    }

    async onClose(code, reason) {
        if (this.ws === null && this.pingInterval) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }

        if (this.destroyed) return

        // 1000 close
        // 1006 closure
        // 1011 error
        // 4401 unauthorized
        const retryable = [1000, 1006, 1011, 4401].includes(code) || code === 0

        if (retryable && this.retryCount < this.maxRetries) {
            this.retryCount++
            await this.destroy(true)
        } else {
            await this.destroy(false)
            this.emit("error", new Error(`Signal closed: ${code} ${reason}`))
        }
    }

    onMessage(res) {
        this.lastLiveness = Date.now()

        let message = null

        try {
            if (typeof res === "string") {
                message = JSON.parse(res)
            } else if (Buffer.isBuffer(res)) {
                message = JSON.parse(res.toString("utf8"))
            } else {
                return
            }
        } catch (error) {
            return
        }

        if (Array.isArray(message.result?.TurnAuthServers)) {
            this.credentials = parseTurnServers(JSON.stringify(message.result))
            this.emit("credentials", this.credentials)
            return
        }

        switch (message.method) {
            case "System_Pong_v1_0":
                this.ws.send(JSON.stringify({ id: message.id, result: null, jsonrpc: "2.0" }))
                break;
            case "PartyChat_ReceiveChat_v1_0":
                if (message.params?.[0]) message.params = message.params[0]
                this.ws.send(JSON.stringify({ id: message.id, result: null, jsonrpc: "2.0" }))
                break;
            default:
                break;
        }

        if (Array.isArray(message.params) && message.params.length === 1) message.params = message.params[0]

        this.emit("message", message)

        this.emit(message.method, message.params)
    }

    write(method, params) {
        if (!this.ws) throw new Error('WebSocket not connected')

        let id = v4()

        const message = JSON.stringify({
            jsonrpc: "2.0",
            method,
            id,
            params
        })

        this.ws.send(message)
    }
}

module.exports = JSONRPC

function parseTurnServers(dataString) {
    const iceServers = []
    const TurnAuthServers = JSON.parse(dataString)?.TurnAuthServers ?? []

    for (const server of TurnAuthServers) {
        const urls = server?.Urls ?? []
        const username = typeof server?.Username === "string" ? server.Username : undefined
        const credential = typeof server?.Password === "string" ? server.Password : (typeof server?.Credential === "string" ? server.Credential : undefined)

        for (const rawUrl of urls) {
            const parsedUrl = parseIceUrl(rawUrl)
            if (!parsedUrl) continue

            const urlCandidates = new Set([formatIceUrl(parsedUrl)])

            if (parsedUrl.isTurn) {
                if (parsedUrl.transport !== "tcp") urlCandidates.add(formatIceUrl({ ...parsedUrl, transport: "udp" }))
                if (parsedUrl.scheme !== "turns") urlCandidates.add(formatIceUrl({ ...parsedUrl, scheme: "turns", port: 5349, transport: "udp" }))
            }

            for (const url of urlCandidates) {
                parsedUrl.isTurn ? iceServers.push({ urls: url, username, credential }) : iceServers.push({ urls: url })
            }
        }
    }

    return iceServers
}

function parseIceUrl(url) {
    const match = url.trim().match(/^(?<scheme>stuns?|turns?)(?::\/\/|:)?(?<host>[^:?\s]+)(?::(?<port>\d+))?(?:\?(?<query>.*))?$/i)
    if (!match || !match.groups) return null

    const scheme = match.groups.scheme.toLowerCase()
    const hostname = match.groups.host
    const port = match.groups.port ? parseInt(match.groups.port, 10) : defaultPortForScheme(scheme)

    if (!hostname || Number.isNaN(port)) return null

    const isTurn = scheme.startsWith("turn")

    let transport
    if (scheme === "turns") transport = "tcp"

    if (isTurn) transport = match.groups.query?.split("&").find(param => param.startsWith("transport="))?.split("=")[1] ?? "udp"
    if (!transport) transport = "udp"

    return { scheme, hostname, port, transport, isTurn }
}

function formatIceUrl(parsed) {
    const protocol = parsed.scheme
    const base = `${protocol}:${parsed.hostname}:${parsed.port}`

    if (!parsed.isTurn) return base

    return `${base}?transport=${parsed.transport ?? "udp"}`
}

function defaultPortForScheme(scheme) {
    return scheme === "stuns" ? 3478 : 5349
}