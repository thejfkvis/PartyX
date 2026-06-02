const { RTCPeerConnection, RTCIceCandidate } = require("@roamhq/wrtc");

async function createRTC(credentials) {
    const peerConnection = new RTCPeerConnection({ iceServers: credentials });
    const dataChannel = peerConnection.createDataChannel("dc");

    await peerConnection.setLocalDescription(await peerConnection.createOffer());

    return peerConnection;
}

module.exports = { createRTC }