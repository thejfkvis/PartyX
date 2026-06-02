const { RTCPeerConnection, RTCIceCandidate } = require("@roamhq/wrtc");

async function createRTC(credentials) {
    const configuration = {
        iceServers: credentials
    };

    const peerConnection = new RTCPeerConnection(configuration);
    const dataChannel = peerConnection.createDataChannel("chat");

    await peerConnection.setLocalDescription(await peerConnection.createOffer());

    return peerConnection;
}

module.exports = { createRTC }