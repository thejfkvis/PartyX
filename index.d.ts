import { EventEmitter } from 'node:events';
import { Authflow, Titles } from 'prismarine-auth'

export interface Options {
    authFolder?: string;
    authflow?: Authflow;
    flow?: string;
    authTitle?: Titles | string;
    deviceType?: string;
    deviceVersion?: string;

    clientVersion?: string;
    privacy?: 'open' | 'closed' | string;
    restrictInvitesToLeader?: boolean;
    autoConnectRPC?: boolean;
    inviteTimeout?: number;
    waitForInvite?: boolean;
    joinManually?: boolean;

    [key: string]: any;
}

export interface PartyInfo {
    id?: string;
    LobbyId?: string;
    [key: string]: any;
}

export interface GatheringParams {
    creatorId: string;
    experienceId: string;
    experienceName: string;
    scenarioId: string;
    serverId: string;
    targetId: string;
    worldId: string;
    worldName: string;
}

export interface RealmsParams {
    destinationScanText: string;
    realmId: string;
}

export interface P2PParams {
    destinationScanText: string;
    xblSessionHandleId: string;
}

export type PubSubMessage = any;

export class Party extends EventEmitter {
    constructor(options?: Options);
    options: Options;
    party: PartyInfo | null;
    pub: any | null;
    rpc: any | null;
    rtc: any | null;
    initialized: boolean;
    presenceInterval?: any;
    MCMAPI: any;
    PUBAPI: any;
    members: Map<String, Object>;
    changeNumber: Number;

    init(): Promise<this>;
    completeInit(party: PartyInfo): Promise<PartyInfo>;
    waitForInvite(timeoutMs?: number): Promise<any>;

    updatePresence(...args: any[]): Promise<any>;
    findParties(): Promise<any[]>;
    createParty(version?: string, privacy?: string, restrict?: boolean): Promise<any>;
    joinParty(partyId: string, version?: string): Promise<any>;
    getPubSubConnectionHandle(): Promise<any>;
    subscribeToLobbyResource(type: string, resourceId: string, connectionHandle: string): Promise<any>;
    getLobby(partyId: string): Promise<any>;
    addUser(xuid: string): Promise<any>;
    invitePlayer(playerId: string, clientVersion?: string): Promise<any>;
    leaveParty(): Promise<any>;

    sendChat(message: string): Promise<any>;
    setLeader(playerId: string): Promise<any>;
    kick(playerId: string, preventRejoin?: boolean): Promise<any>;

    setDestination(type: 'gathering', params: GatheringParams): Promise<any>;
    setDestination(type: 'realms', params: RealmsParams): Promise<any>;
    setDestination(type: 'p2p', params: P2PParams): Promise<any>;

    deleteDestination(type: 'gathering' | 'realms' | 'p2p'): Promise<any>;
    connectRPC(partyId?: string, version?: string): Promise<any>;

    on(event: 'ready', listener: (info: { partyId: string; party: PartyInfo }) => void): this;
    on(event: 'disconnect', listener: (reason: String) => void): this;
    on(event: 'join', listener: (data: Object) => void): this;
    on(event: 'leave', listener: (data: Object) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'ReceiveMessage_Pub', listener: (msg: PubSubMessage) => void): this;
    on(event: 'ReceiveSubscriptionChangeMessage_Pub', listener: (msg: PubSubMessage) => void): this;
    on(event: 'credentials', listener: (credentials: any) => void): this;
    on(event: 'connected', listener: (rtc: any) => void): this;
    on(event: 'message', listener: (data: any) => void): this;
    on(event: 'PartyChat_ReceiveChat_v1_0', listener: (params: any) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
}

export { Party as default };