const { Party } = require("../index");
const { Authflow, Titles } = require("prismarine-auth");

(async () => {
    const authflow = new Authflow(undefined, "./auth", {
        flow: "sisu",
        authTitle: Titles.MinecraftNintendoSwitch,
        deviceType: "Nintendo",
        deviceVersion: "0.0.0",
    });

    const PAPI = new Party({
        authFolder: "./auth",
        authflow,
        clientVersion: "1.26.21",
        privacy: "open",
        restrictInvitesToLeader: false,
        autoConnectRPC: true,
        joinManually: true,
        /*
            waitForInvite: true,
            inviteTimeout: 60000,
            flow: "sisu",
            authTitle: Titles.MinecraftNintendoSwitch,
            deviceType: "Nintendo",
            deviceVersion: "0.0.0"
        */
    });

    try {
        await PAPI.init();

        const parties = await PAPI.findParties();
        const party = await PAPI.joinParty(parties[0].id);
        await PAPI.completeInit(party.result);

        console.log("Party Joined with ID:", PAPI.party.id);

        PAPI.on("message", (msg) => {
            console.log("Received message:", msg);
        });

        PAPI.on("PartyChat_ReceiveChat_v1_0", (params) => {
            console.log(`[Chat] ${params.Sender}: ${params.ScanText}`);
        });

        PAPI.on("disconnect", (reason) => {
            console.log("Reason", reason)
        })

        PAPI.on("join", (e) => {
            console.log("A new player has joined!", e)
        })

        PAPI.on("leave", (e) => {
            console.log("A player has left!", e)
        })

        PAPI.on("connected", (rtc) => {
            console.log("Connected");
        });
    } catch (error) {
        console.error("Failed to initialize party:", error);
    }
})();