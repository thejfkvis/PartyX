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
        waitForInvite: true,
        /*
            joinManually: true,
            inviteTimeout: 60000,
            flow: "sisu",
            authTitle: Titles.MinecraftNintendoSwitch,
            deviceType: "Nintendo",
            deviceVersion: "0.0.0"
        */
    });

    try {
        await PAPI.init();

        console.log(PAPI.party)

        console.log("Party Joined with ID:", PAPI.party.id);

        PAPI.on("message", (msg) => {
            console.log("Received message:", msg);
        });

        PAPI.on("PartyChat_ReceiveChat_v1_0", (params) => {
            console.log(`[Chat] ${params.Sender}: ${params.ScanText}`);
        });

        PAPI.on("left", (reason) => {
            console.log("Reason", reason)
        })

        PAPI.on("connected", (rtc) => {
            console.log("Connected");
        });
    } catch (error) {
        console.error("Failed to initialize party:", error);
    }
})();