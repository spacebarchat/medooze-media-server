import * as Native from "./Native";
import Emitter from "medooze-event-emitter";
import * as SharedPointer from "./SharedPointer";
import * as NetworkUtils from "./NetworkUtils";
import LFSR from "lfsr";
import { v4 as uuidV4 } from "uuid";

import SemanticSDP, {
    SDPInfo,
    Setup,
    MediaInfo,
    CandidateInfo,
    DTLSInfo,
    ICEInfo,
    StreamInfo,
    TrackInfo,
    SourceGroupInfo,
	TrackInfoLike,
	ICEInfoLike,
	TrackType,
} from "semantic-sdp";

import * as Utils from "./Utils";
import {IncomingStream } from "./IncomingStream";
import {OutgoingStream} from "./OutgoingStream";
import {IncomingStreamTrack, NativeSourceMap} from "./IncomingStreamTrack";
import {OutgoingStreamTrack} from "./OutgoingStreamTrack";
import * as Endpoint from "./Endpoint";

let maxId = 0;

const noop = function(){};

/**
 * DTLS connection state as per the w3c spec
 */
export type DTLSState = "new" | "connecting" | "connected" | "closed" | "failed";

export interface TransportDumpOptions {
	/** Dump incoming RTP data [Default: true] */
    incoming?: boolean;
	/** Dump outgoing RTP data [Default: true] */
    outgoing?: boolean;
	/** Dump rtcp RTP data [Default: true] */
    rtcp?: boolean;
	/** Dump only rtp headers and first 16 bytes of payload for rtp packets [Default: false] */
    rtpHeadersOnly?: boolean;
	/** Dump bwe stats to a different file (.pcap->.csv) [Default: true] */
    bwe?: boolean;
	/** When dumping bwe stats to a file, if it grows over this size wrap it up and start a new file [Default: 0 (No limit)] */
    bweFileSize?: number;
}

export interface TransportStats {
	/** Sender side estimation bitrate (if available) */
    senderSideEstimationBitrate: number;
    senderSideTargetBitrate: number;
    ice?: ICEStats;
}

/** ICE related stats */
export interface ICEStats {
	/** Number of ice requests sent */
    requestsSent: number;
	/** Number of ice requests received */
    requestsReceived: number;
	/** Number of ice responses sent */
    responsesSent: number;
	/** Number of ice responses received */
    responsesReceived: number;
}

export interface SSRCs {
	/** ssrc for the media track */
    media: number;
	/** ssrc for the fec track (only applicable to video tracks) */
    fec?: number;
	/** ssrc for the rtx track (only applicable to video tracks) */
    rtx?: number;
}

export interface CreateStreamTrackOptions {
	/** Stream track id (default: "audio" for audio tracks, "video" for video tracks) */
    id?: string;
	/** Stream track media id (mid) */
    mediaId?: string;
	/** Stream track rid */
    rid?: string;
	/** Override the generated ssrcs for this track */
    ssrcs?: SSRCs;
}

export interface CreateStreamOptions {
    id?: string;
	/** Add audio track to the new stream */
    audio?: TrackInfoLike[] | TrackInfoLike;
	/** Add video track to the new stream */
    video?: TrackInfoLike[] | TrackInfoLike;
}

interface TransportEvents {
    stopped: (self: Transport) => void;
	/** ICE timeout. Fired when no ICE request ar received for 30 seconds. */
    icetimeout: (self: Transport) => void;
	/** DTLS State change */
    dtlsstate: (state: DTLSState, self: Transport) => void;
	/** ICE remote candidate activation. This event fires when ICE candidate has correctly being checked out and we start using it for sending. (`candidate` is the ip and port of the remote ICE candidate that is in use by the transport) */
    remoteicecandidate: (candidate: CandidateInfo, self: Transport) => void;
	/** Transport sender side estimation bitrate target update */
    targetbitrate: (targetBitrate: number, bandwidthEstimation: number, totalBitrate: number, self: Transport) => void;
	/** New incoming stream track added to transport */
    incomingtrack: (track: IncomingStreamTrack, stream?: IncomingStream) => void;
	/** New outgoing stream track added to transport */
    outgoingtrack: (track: OutgoingStreamTrack, stream?: OutgoingStream) => void;
	/** Error occurred when calling {@link setCandidateRawTxData} on behalf of the user */
    rawtxdataerror: (ip: string, port: number, error: any) => void;
}

/**
 * A transport represent a connection between a local ICE candidate and a remote set of ICE candidates over a single DTLS session.
 * The transport object will internally allocate the ICE and DTLS information of the local side in order to signal it to the remote side and establish the connection.
 * Each transport has a set of incoming and outgoing streams that allow to send or receive RTP streams to the remote peer. 
 * You must create the incoming streams as signaled on the remote SDP as any incoming RTP with an unknown ssrc will be ignored. 
 * When you create an outgoing stream, the transport will allocate internally the ssrcs for the different RTP streams in order to avoid collision. You will be able to retrieve that information from the streams object in order to be able to announce them on the SDP sent to the remote side.
 * In order to decide how to route your streams you must attach the outgoing streams from one transport to the incoming streams of other (or same) transport.
 */
export class Transport extends Emitter<TransportEvents>
{
	readonly bundle: Endpoint.NativeBundle;
    readonly remote: Endpoint.ParsedPeerInfo & { candidates: CandidateInfo[] };
    local: Endpoint.ParsedPeerInfo;
    username: string;
    connection: SharedPointer.Proxy<Native.RTPBundleTransportConnectionShared>;
    transport: SharedPointer.Proxy<Native.DTLSICETransportShared>;
    dtlsState: DTLSState = "new";
    listener: Native.DTLSICETransportListenerShared;
    lfsr: LFSR;
    stopped = false;
    audioRTX = false;
    dumping = false;
    senderSideTargetBitrate?: number;
    senderSideEstimationBitrate?: number;
    bandwidthProbing?: boolean;
    senderSideListener: Native.SenderSideEstimatorListener;

    incomingStreams: Map<string, IncomingStream> = new Map();
    outgoingStreams: Map<string, OutgoingStream> = new Map();
    incomingStreamTracks: Map<string, IncomingStreamTrack> = new Map();
    outgoingStreamTracks: Map<string, OutgoingStreamTrack> = new Map();

	// native callbacks
	onicetimeout: () => void;
    ondtlsstate: (state: DTLSState) => void;
    onremoteicecandidate: (ip: string, port: number, priority: number) => void;
    onunsignaledincomingsourcegroup: (group: Native.RTPIncomingSourceGroupShared) => void;
	ontargetbitrate: (targetBitrate: number, bandwidthEstimation: number, totalBitrate: number) => void;
	
	constructor(
        bundle: Endpoint.NativeBundle,
        remote: Endpoint.ParsedPeerInfo,
        local: Endpoint.ParsedPeerInfo,
        options: Endpoint.CreateTransportOptions
    ) {
		//Init emitter
		super();

		//Ensure we have ice and dtls on remote
		if (!remote || !remote.ice || !remote.dtls)
			//Throw errror
			throw new Error("You must provide remote ice and dtls info");
		
		//Store remote properties
		this.remote = { ...remote, candidates: [] };
		
		//Create local info
		this.local = local;
		
		//Create new native properties object
		let properties = new Native.Properties();

		//Put ice properties
		properties.SetStringProperty("ice.localUsername"	, String(this.local.ice.getUfrag()));
		properties.SetStringProperty("ice.localPassword"	, String(this.local.ice.getPwd()));
		properties.SetStringProperty("ice.remoteUsername"	, String(this.remote.ice.getUfrag()));
		properties.SetStringProperty("ice.remotePassword"	, String(this.remote.ice.getPwd()));

		//Put remote dtls properties
		if (options?.prefferDTLSSetupActive && remote.dtls.getSetup() == Setup.ACTPASS) {
			properties.SetStringProperty("dtls.setup"	, String(Setup.toString(Setup.PASSIVE)));
		} else {
			properties.SetStringProperty("dtls.setup"	, String(Setup.toString(remote.dtls.getSetup())));
		}
		properties.SetStringProperty("dtls.hash"		, String(remote.dtls.getHash()));
		properties.SetStringProperty("dtls.fingerprint"		, String(remote.dtls.getFingerprint()));
		
		//Put other options
		properties.SetBooleanProperty("disableSTUNKeepAlive"	, Boolean(options.disableSTUNKeepAlive));
		properties.SetStringProperty("srtpProtectionProfiles"	, String(options.srtpProtectionProfiles));

		//If disabling REMB calculus
		if (!!options.disableREMB) {
			//Override it
			properties.SetBooleanProperty("remb.disabled"	, true);
		}
		
		//Create username
		this.username = this.local.ice.getUfrag() + ":" + this.remote.ice.getUfrag();
		
		//Store bundle
		this.bundle = bundle;
		//No state yet
		this.dtlsState = "new";
		//Create native onnection
		this.connection = SharedPointer.SharedPointer(bundle.AddICETransport(this.username,properties));
		//Get transport
		this.transport = SharedPointer.SharedPointer(this.connection.transport);

		//If overriding the bwe
		if (!!options.overrideBWE)
			//Override it
			this.transport.SetRemoteOverrideBWE(true);

		//Event listener for ice timoute
		this.onicetimeout = () => {
			this.emit("icetimeout", this);
		};
		//Event listener for dtls state changes
		this.ondtlsstate = (state: DTLSState) => {
			//Store dtls state
			this.dtlsState = state;
			this.emit("dtlsstate",state, this);
		};
		//Event listener for ice candidate activation
		this.onremoteicecandidate = (ip: string, port: number, priority: number,
		) => {
			this.emit("remoteicecandidate", new CandidateInfo("1", 1, "UDP", priority, ip, port, "host"), this);
		};

		this.onunsignaledincomingsourcegroup = (group: Native.RTPIncomingSourceGroupShared) => {
			//Create shared pointer wrapper
			const shared = SharedPointer.SharedPointer(group);
			//Get group mid
			const mid = shared.mid;
			const encodingId = shared.rid;

			let track;

			//Try to find the track in all the streams
			for (const incomingStream of this.incomingStreams.values())
			{
				for (const incomingStreamTrack of incomingStream.getTracks())
				{
					if (incomingStreamTrack.getMediaId() == mid)
					{
						track = incomingStreamTrack
						break;
					}
				}
			}
			//If not, try on standalone tracks
			if (!track)
			{
				for (const incomingStreamTrack of this.incomingStreamTracks.values())
				{
					if (incomingStreamTrack.getMediaId() == mid)
					{
						track = incomingStreamTrack
						break;
					}
				}
			}
			//If found
			if (track)
			{
				//Add new source to track
				track.addIncomingSource(encodingId,shared);
				//When track is ended
				track.on("stopped",()=>{
					//Remove source group
					this.transport.RemoveIncomingSourceGroup(shared);
				});
			}
		};

		//Craeate transport listener
		this.listener = new Native.DTLSICETransportListenerShared(this);
		//Set it
		this.transport.SetListener(this.listener);
		
		//Event listener for sender side estimator
		this.ontargetbitrate = (targetBitrate:number,bandwidthEstimation: number,totalBitrate: number)  => {
			//Store sender side estimator
			this.senderSideTargetBitrate = targetBitrate;
			this.senderSideEstimationBitrate = bandwidthEstimation;
			this.emit("targetbitrate",targetBitrate,bandwidthEstimation,totalBitrate,this);
		};
		//Create native listener
		this.senderSideListener = new Native.SenderSideEstimatorListener(this);
		//Attach to transport
		this.transport.SetSenderSideEstimatorListener(this.senderSideListener);
		//If no transport
		if (!this.transport)
			//error
			throw new Error("Could not create native transport");
		
		//Add remote candidates
		this.addRemoteCandidates(remote.candidates || []);
		
		//List of streams
		this.incomingStreams = new Map<string, IncomingStream>();
		this.outgoingStreams = new Map<string, OutgoingStream>();
		//LIst of tracks
		this.incomingStreamTracks = new Map<string, IncomingStreamTrack>();
		this.outgoingStreamTracks = new Map<string, OutgoingStreamTrack>();
		
		//Create new sequence generator
		this.lfsr = new LFSR();
	}
	
	/**
	 * Dump incoming and outgoint rtp and rtcp packets into a pcap file
	 * @param {String} filename - Filename of the pcap file
	 * @param {TransportDumpOptions} [options]  - Dump parameters
	 */
	dump(filename: string, options?: TransportDumpOptions): void
	{
		//Get what do we want to dump
		const incoming		= options ? Boolean(options.incoming) : true;
		const outgoing		= options ? Boolean(options.outgoing) : true;
		const rtcp		= options ? Boolean(options.rtcp) : true;
		const rtpHeadersOnly	= options ? Boolean(options.rtpHeadersOnly) : false;
		const bwe		= options ? Boolean(options.bwe) : true;
		const bweFileSize	= options ? Number(options.bweFileSize || 0) : 0;
		
		//Check we are dumping anything
		if (incoming || outgoing || rtcp)
		{
			//Start dumping
			if (!this.transport.Dump(filename, incoming, outgoing, rtcp, rtpHeadersOnly))
				throw new Error("Could not dump to pcap file");
			this.dumping = true;
		}
		//Check if we are dumping bwe
		if (bwe && typeof filename==="string")
			//Start dumping
			if (!this.transport.DumpBWEStats(filename.replace(".pcap",".csv"), bweFileSize))
				throw new Error("Could not dump to bwe csv file");
	}
	
	/**
	 * Stop dumping transport rtp and rtcp packets
	 */
	stopDump(): void
	{
		//Stop
		if (this.dumping)
			this.transport.StopDump();
		this.dumping = false;
		this.transport.StopDumpBWEStats();
	}
	
	/**
	 * Get transport stats
	 * @return {TransportStats} stats
	 */
	getStats(): TransportStats
	{
		return {
			senderSideEstimationBitrate	: this.senderSideEstimationBitrate!,
			senderSideTargetBitrate		: this.senderSideTargetBitrate!,
			ice : this.connection ? {
				requestsSent		: this.connection.iceRequestsSent,
				requestsReceived	: this.connection.iceRequestsReceived,
				responsesSent		: this.connection.iceResponsesSent,
				responsesReceived	: this.connection.iceResponsesReceived
			} : undefined
		};
	}

	/**
	 * Restart ICE on transport object
	 * @param {SemanticSDP.ICEInfoLike}  remoteICE_	Remote ICE info, containing the username and password
	 * @param {SemanticSDP.ICEInfoLike}  [localICE_] Local ICE info, containing the username and password
	 * @returns {ICEInfo}	Local ICE info
	 */
	restartICE(remoteICE_: ICEInfoLike, localICE_: ICEInfoLike): ICEInfo
	{
		//Support both plain js object and SDPInfo
		const remoteICE = ICEInfo.expand(remoteICE_);

		//If there is no local info
		const localICE = !localICE_ ?
			//Generate one
			ICEInfo.generate(true) :
			//Otherwise use the supplied one
			ICEInfo.expand(localICE_);

		//Create new native properties object
		const properties = new Native.Properties();

		//Put ice properties
		properties.SetStringProperty("ice.localUsername"	, String(localICE.getUfrag()));
		properties.SetStringProperty("ice.localPassword"	, String(localICE.getPwd()));
		properties.SetStringProperty("ice.remoteUsername"	, String(remoteICE.getUfrag()));
		properties.SetStringProperty("ice.remotePassword"	, String(remoteICE.getPwd()));

		//Create new username
		const username = localICE.getUfrag() + ":" + remoteICE.getUfrag();

		//Update attributes
		if (!this.bundle.RestartICETransport(this.username, username, properties))
			throw Error("Could not update ice info on transport");

		//Update username
		this.username = username;

		//Update local and remote properties
		this.local.ice  = localICE;
		this.remote.ice = remoteICE;

		//Return our local info
		return localICE;
	}

	/**
	 * Get ICE username
	 * @returns {string} 
	 */
	getICEUsername(): string
	{
		return this.username;
	}

	/**
	 * Get available outgoing bitrate in bps.
	 * @returns {Number} 
	 */
	getAvailableOutgoingBitrate(): number
	{
		return this.transport.GetAvailableOutgoingBitrate();
	}

	/**
	 * Get bandwidth estimation in bps.
	 * @returns {Number} 
	 */
	getEstimatedBitrate(): number
	{
		return this.transport.GetEstimatedOutgoingBitrate();
	}

	/**
	 * Get current sent bitrate
	 * @returns {Number} 
	 */
	getTotalSentBitrate(): number
	{
		return this.transport.GetTotalSentBitrate();
	}
	
	/**
	 * Enable bitrate probing.
	 * This will send padding only RTX packets to allow bandwidth estimation algortithm to probe bitrate beyond current sent values.
	 * The amount of probing bitrate would be limited by the sender bitrate estimation and the limit set on the setMaxProbing Bitrate.
	 * Note that this will only work on browsers that supports RTX and transport wide cc.
	 * @param {boolean} probe
	 */
	setBandwidthProbing(probe: boolean): void
	{
		//Do not call native code if setting the same value
		if (Boolean(probe)===this.bandwidthProbing)
			return;
		//Cache value
		this.bandwidthProbing = Boolean(probe);
		//Set it
		this.transport.SetBandwidthProbing(this.bandwidthProbing);
	}
	
	/**
	 * Set the maximum bitrate to be used if probing is enabled.
	 * @param {Number} bitrate bitrate in bps
	 */
	setMaxProbingBitrate(bitrate: number): void
	{
		//Set value
		this.transport.SetMaxProbingBitrate(Math.max(bitrate || 0, 0));
	}


	/**
	 * Enable or disable calculation of sender side estimation if transport wide cc has been negotiated
	 * @param {Boolean} enabled
	 */
	enableSenderSideEstimation(enabled: boolean): void
	{
		//Set value
		this.transport.EnableSenderSideEstimation(!!enabled);
	}


	/**
	 * Override the bitrate sent by REMB to the remote sender. The transport must be constructed with the override bwe option, and transport wide cc must not be offered.
	 * @param {Number} bitrate
	 */
	setRemoteOverrideBitrate(bitrate: number): void
	{
		//Set value
		this.transport.SetRemoteOverrideBitrate(Math.max(bitrate || 0, 0));
	}
	
	/**
	 * Do not allow probing to increase sent bitrate above certain limit
	 * @param {Number} bitrate limit
	 */
	setProbingBitrateLimit(bitrate: number): void
	{
		//Set value
		this.transport.SetProbingBitrateLimit(Math.max(bitrate || 0, 0));
	}
	
	/**
	 * Set local RTP properties 
	 * @param {Utils.RTPProperties | SDPInfo} rtp
	 */
	setLocalProperties(rtp: Utils.RTPProperties | SDPInfo): void
	{
		//Get native properties
		let properties = Utils.convertRTPProperties(Utils.parseRTPProperties(rtp));
		//Set it
		this.transport.SetLocalProperties(properties);
	}
	
	/**
	 * Set remote RTP properties 
	 * @param {Utils.RTPProperties | SDPInfo} rtp
	 */
	setRemoteProperties(rtp: Utils.RTPProperties | SDPInfo): void
	{
		const parsed = Utils.parseRTPProperties(rtp);
		//Get native properties
		let properties = Utils.convertRTPProperties(parsed);
		//Check if remote audio supports rtx
		if (parsed.audio)
		{
			//Supppor plain and Semantic SDP objects
			const audioInfo = MediaInfo.expand(parsed.audio);
			//Check all codecs
			for (const [type,codec] of audioInfo.getCodecs())
			{
				//If it has rtx
				if (codec.hasRTX())
				{
					//Support rtx for audio
					this.audioRTX = true;
					//Done
					break;
				}
			}
		}
		//Set it
		this.transport.SetRemoteProperties(properties);
	}
	
	/**
	 * Get current dtls state for transport
	 * @returns {DTLSState}
	 */
	getDTLSState(): DTLSState
	{
		return this.dtlsState;
	}

	/**
	 * Get transport local DTLS info
	 * @returns {DTLSInfo} DTLS info object
	 */
	getLocalDTLSInfo(): DTLSInfo
	{
		return this.local.dtls;
	}
	
	/**
	 * Get transport local ICE info
	 * @returns {ICEInfo} ICE info object
	 */
	getLocalICEInfo(): ICEInfo
	{
		return this.local.ice;
	}

	/**
	 * Get local ICE candidates for this transport
	 * @returns {Array<CandidateInfo>}
	 */
	getLocalCandidates(): CandidateInfo[] 
	{
		//Return local host candiadate as array
		return this.local.candidates;
	}
		
	/**
	 * Get transport remote DTLS info
	 * @returns {DTLSInfo} DTLS info object
	 */
	getRemoteDTLSInfo(): DTLSInfo
	{
		return this.remote.dtls;
	}
	
	/**
	 * Get transport remote ICE info
	 * @returns {ICEInfo} ICE info object
	 */
	getRemoteICEInfo(): ICEInfo
	{
		return this.remote.ice;
	}

	/**
	 * Get remote ICE candidates for this transport
	 * @returns {Array<CandidateInfo>}
	 */
	getRemoteCandidates(): CandidateInfo[] 
	{
		//Return local host candiadate as array
		return this.remote.candidates;
	}

	/**
	 * Register a remote candidate info. Only needed for ice-lite to ice-lite endpoints
	 * @param {CandidateInfo} candidate
	 * @returns {boolean} Wheter the remote ice candidate was alrady presnet or not
	 */
	addRemoteCandidate(candidate: CandidateInfo): boolean
	{
		//Check transport
		if (candidate.getTransport().toLowerCase()!="udp")
			return false;

		let ip: string;
		let port: number;
		
		//If it is a relay candidate
		if ("relay"===candidate.getType())
		{
			//Get relay ip and port
			const [relIp, relPort] = [candidate.getRelAddr(), candidate.getRelPort()];
			if (!relIp || !relPort)
				return false;
			[ip, port] = [relIp, relPort];
		} else {
			//Get ip and port
			ip   = candidate.getAddress();
			port = candidate.getPort();
		}
		//Create new candidate on bundle for this transport
		if (!this.bundle.AddRemoteCandidate(this.username, ip, port))
			return false;

		//Add candidate to remote list
		this.remote.candidates.push(candidate.clone());

		//Collect and set raw TX data, if raw TX is active
		//TODO: Change addRemoteCandidate to async
		this.setCandidateRawTxData(ip, port).catch(e => {
			//Do nothing if stopped
			if (this.stopped) return;
			//Emit error for now
			this.emit("rawtxdataerror", ip, port, e);
		});

		return true;
	}

	async setCandidateRawTxData(ip: string, port: number): Promise<void>
	{
		const ifindex = this.bundle.rawTxInterface;
		if (ifindex === undefined)
			return;

		//If raw TX is currently active in the bundle, fetch raw TX data for this candidate from OS
		const rawTxData = await NetworkUtils.collectCandidateInfo(ip, port, ifindex);

		//Send data to endpoint thread
		return this.bundle.SetCandidateRawTxData(ip, port, ...rawTxData);
	}
	
	/**
	 * Register an array remote candidate info. Only needed for ice-lite to ice-lite endpoints
	 * @param {Array<CandidateInfo>} candidates
	 */
	addRemoteCandidates(candidates: CandidateInfo[]): void
	{
		//For each
		for (const candidate of candidates)
			//Add candidate
			this.addRemoteCandidate(candidate);
	}
	
	/**
	 * Create new outgoing stream in this transport
	 * @param {CreateStreamOptions | SemanticSDP.StreamInfoLike | String} [params] Params plain object, StreamInfo object or stream id
	 * @returns {OutgoingStream} The new outgoing stream
	 */
	createOutgoingStream(params?: CreateStreamOptions | StreamInfo | string): OutgoingStream
	{
		let streamInfo: StreamInfo;
		//Generate the stream info from paramss
		if (params && params.constructor.name === "StreamInfo")
		{
			//Convert
			streamInfo = StreamInfo.clone((params as StreamInfo));
		} else if (typeof params === 'string') {
			//Param is the media id
			streamInfo = new StreamInfo(params);
		} else if (params && params.id )  {
			//Use provided one
			streamInfo = new StreamInfo(params.id);
		} else {
			//Generate ramdon
			streamInfo = new StreamInfo(uuidV4());
		}

		//IF we already have that id
		if (this.incomingStreams.has(streamInfo.getId()))
			//Launch exception
			throw new Error("Duplicated stream id");

		// from here on, we can assume `params` holds the plain object
		params = (params as CreateStreamOptions);

		//If we have audio
		if (params && params.audio)
		{
			//Check if it is an array
			const audios = Array.isArray(params.audio) ? params.audio : [params.audio];
			
			//For each audio
			for (const audio of audios)
			{
				//Crete new track
				let track = new TrackInfo("audio", audio.id || ("audio" + (maxId++)));
				//Set mid
				track.setMediaId(audio.mediaId!);
				//Generte new ssrc
				let ssrc = audio.ssrcs ? (Array.isArray(audio.ssrcs) ? audio.ssrcs[0] : audio.ssrcs.media) : this.lfsr.seq(31);
				let rtx  = audio.ssrcs ? (Array.isArray(audio.ssrcs) ? audio.ssrcs[1] : audio.ssrcs.rtx)   : this.lfsr.seq(31);
				//Add to track
				track.addSSRC(ssrc);

				//Check if rtx is enabled
				if (rtx && this.audioRTX)
				{
					//Add ssrc and group
					track.addSSRC(rtx);
					track.addSourceGroup (new SourceGroupInfo("FID",[ssrc,rtx]));
				}

				//Add track to stream
				streamInfo.addTrack(track);
			}
		}

		//If we have video
		if (params && params.video)
		{
			//Check if it is an array
			const videos = Array.isArray(params.video) ? params.video : [params.video];
			
			//For each audio
			for (const video of videos)
			{
				//Crete new track
				let track = new TrackInfo("video", video.id || ("video" + (maxId++)));
				//Set mid
				track.setMediaId(video.mediaId!);
				//Generte new ssrc
				let ssrc = video.ssrcs ? (Array.isArray(video.ssrcs) ? video.ssrcs[0] : video.ssrcs.media) : this.lfsr.seq(31);
				let fec  = video.ssrcs ? (Array.isArray(video.ssrcs) ? video.ssrcs[1] : video.ssrcs.fec)   : this.lfsr.seq(31);
				let rtx  = video.ssrcs ? (Array.isArray(video.ssrcs) ? video.ssrcs[2] : video.ssrcs.rtx)   : this.lfsr.seq(31);

				//Add main ssrc to track
				track.addSSRC(ssrc);
				//Handle rtx
				if (rtx)
				{
					//Add ssrc and group
					track.addSSRC(rtx);
					track.addSourceGroup (new SourceGroupInfo("FID",[ssrc,rtx]));
				}

				//Check if fec is enabled
				if (fec)
				{
					//Add ssrc and group
					track.addSSRC(fec);
					track.addSourceGroup (new SourceGroupInfo("FEC-FR",[ssrc,fec]));
				}

				if (video.encodings)
					track.addEncoding(SemanticSDP.TrackEncodingInfo.expand(video.encodings[0][0]));

				// todo: find why rid is not in the typings
				if ((video as any).rid != undefined)
				{
					//Create encoding
					const encoding = new SemanticSDP.TrackEncodingInfo((video as any).rid);
					//Add ssrc
					encoding.addParam("ssrc", ssrc.toString())
					//Add to encodngs
					track.addAlternativeEncodings([
						encoding
					]);
				}

				//Add track to stream
				streamInfo.addTrack(track);
			}
		}

		//Create the stream 
		const outgoingStream = new OutgoingStream(streamInfo.getId(), this);
				
		//Add to list
		this.outgoingStreams.set(outgoingStream.getId(),outgoingStream);

		//Add stopped listener
		outgoingStream.once("stopped",() => {
			//Remove it
			this.outgoingStreams.delete(outgoingStream.getId());
		});
		
		//For each track in the info
		for (const [trackId,trackInfo] of streamInfo.getTracks())
			//Create track in stream
			this.createOutgoingStreamTrack(trackInfo.getMedia(), trackInfo, outgoingStream);
			
		//Return it
		return outgoingStream;
	}
	
	/**
	 * Create new outgoing stream in this transport
	 * @param {SemanticSDP.TrackType} media - Media type
	 * @param {CreateStreamTrackOptions | SemanticSDP.TrackInfoLike | string } params Params plain object or TrackInfo object
	 * @param {OutgoingStream} [outgoingStream] outgoingStream Outgoing stream to add the track to, if any
	 * @returns {OutgoingStreamTrack} The new outgoing stream track
	 */
	createOutgoingStreamTrack(media: TrackType, params: CreateStreamTrackOptions | SemanticSDP.TrackInfoLike, outgoingStream?: OutgoingStream): OutgoingStreamTrack
	{
		const trackInfo = params
			? TrackInfo.expand(Object.assign({
				id : String(media + (maxId++))
			}, {media: media }, params))
			: new TrackInfo(media, String(media + (maxId++)));

		//Create uuid
		const uuid = (outgoingStream?.getId() ?? "") + "@" + trackInfo.getId();

		//IF we already have that id
		if (this.outgoingStreamTracks.has(uuid))
			//Launch exception
			throw new Error("Duplicated stream id");
		
		//Get encoding sources found on track info
		const encodingSources = trackInfo.getEncodingSources();
		//If trying to do simulcast
		if (encodingSources.length!=1)
			//Launch exception
			throw new Error("Incorrect number of encoding sources found in track " + encodingSources.length);

		//Get media id if specified
		const mediaId = trackInfo.getMediaId() ?? "";

		//Only one source allowed
		const encodingSource = encodingSources[0];

		//Create incoming track
		const source = SharedPointer.SharedPointer(new Native.RTPOutgoingSourceGroupShared(
			mediaId,
			Utils.mediaToFrameType(media),
			this.transport.GetTimeService())
		);

		//Set ids
		source.mid	= mediaId;
		source.rid	= encodingSource.rid	 ?? "";

		//If we are given the ssrcs
		if (encodingSource.media)
		{
			//Set source ssrcs from input params
			source.media.ssrc	= encodingSource.media;
			source.rtx.ssrc		= encodingSource.rtx ?? 0;
			source.fec.ssrc		= encodingSource.fec ?? 0;
		} else  {
			//Generate them
			source.media.ssrc	= this.lfsr.seq(31);
			//Only allow rtx/fec for video for now
			if (media == "video")
			{
				//Set both rtx and fec
				source.rtx.ssrc	= this.lfsr.seq(31);
				source.fec.ssrc = this.lfsr.seq(31);
			} 
			else if (this.audioRTX) 
			{
				//Allow rtx on audio too
				source.rtx.ssrc	= this.lfsr.seq(31);
			}
		}

		//Add it to transport
		if (!this.transport.AddOutgoingSourceGroup(source))
			//Launch exception
			throw new Error("Could not add incoming source group to native transport");
			
		//Create new track
		const outgoingStreamTrack = new OutgoingStreamTrack(
			media,
			trackInfo.getId(),
			trackInfo.getMediaId(),
			this.transport.toRTPSender(),
			source
		);

		//Add listener
		outgoingStreamTrack.once("stopped",()=>{
			//Remove from transport
			this.transport.RemoveOutgoingSourceGroup(source);
			//Remove from tracks
			this.outgoingStreamTracks.delete(uuid);
		});
		
		//Add to the track list
		this.outgoingStreamTracks.set(outgoingStreamTrack.getId(),outgoingStreamTrack);

		//Add to the stream if any
		if (outgoingStream) outgoingStream.addTrack(outgoingStreamTrack);
		
		//Emit new track event
		this.emit("outgoingtrack", outgoingStreamTrack, outgoingStream);
			
		//Return it
		return outgoingStreamTrack;
	}
	
	/**
	 * Create an incoming stream object from the media stream info objet
	 * @param {StreamInfo | SemanticSDP.StreamInfoPlain | String} params Contains the ids and ssrcs of the stream to be created, or a plain stream id
	 * @returns {IncomingStream} The newly created incoming stream object
	 */
	createIncomingStream(params: StreamInfo | SemanticSDP.StreamInfoPlain | string): IncomingStream
	{
		const info: StreamInfo = typeof params == "string" 
			? new StreamInfo(params)
			: StreamInfo.clone(params);

		//IF we already have that id
		if (this.incomingStreams.has(info.getId()))
			//Launch exception
			throw new Error("Duplicated stream id");
		
		//We have to add the incmoing source for this stream
		let incomingStream = new IncomingStream(
			info.getId(),
			this
		);
		
		//Add to list
		this.incomingStreams.set(incomingStream.getId(),incomingStream);
		
		//Add new track listener
		incomingStream.on("track",(stream, track) => {
			//Emit evetn
			this.emit("incomingtrack",track,incomingStream);
		});
		
		//Add stream stoplistener
		incomingStream.once("stopped",() => {
			//Remove it
			this.incomingStreams.delete(incomingStream.getId());
		});
		
		//For each tracks
		for (let trackInfo of info.getTracks().values())
			//Create new track from info
			incomingStream.createTrack(trackInfo.getMedia(), trackInfo);
			
		//Return it
		return incomingStream;
	}
	
	
	/**
	 * Get all the incoming streams in the transport
	 * @returns {IncomingStream[]}
	 */
	getIncomingStreams(): IncomingStream[]
	{
		return Array.from(this.incomingStreams.values());
	}
	
	/**
	 * Get incoming stream
	 * @param {String} streamId the stream ID
	 * @returns {IncomingStream | undefined}
	 */
	getIncomingStream(streamId: string): IncomingStream | undefined
	{
		//Return it
		return this.incomingStreams.get(streamId);
	}
	
	/**
	 * Get all the outgoing streams in the transport
	 * @returns {OutgoingStream[]}
	 */
	getOutgoingStreams(): OutgoingStream[]
	{
		return Array.from(this.outgoingStreams.values());
	}
	
	/**
	 * Get outgoing stream
	 * @param {String} streamId the stream ID
	 * @returns {OutgoingStream | undefined}
	 */
	getOutgoingStream(streamId: string): OutgoingStream | undefined
	{
		//Return it
		return this.outgoingStreams.get(streamId);
	}
	
	/**
	 * Create new incoming stream in this transport. TODO: Simulcast is still not supported
	 * @param {SemanticSDP.TrackType} media Track media type
	 * @param {SemanticSDP.TrackInfoLike} [params] Track parameters
	 * @param {IncomingStream} [incomingStream] Stream to add the track to, if any
	 * @returns {IncomingStreamTrack} The new incoming stream track
	 */
	createIncomingStreamTrack(media: TrackType, params?: TrackInfoLike, incomingStream?: IncomingStream): IncomingStreamTrack
	{
		const trackInfo: TrackInfo = params
			? TrackInfo.expand(params) 
			: new TrackInfo(media, String(media + (maxId++)));
	
		//Create uuid
		const uuid = (incomingStream?.getId() ?? "") + "@" + trackInfo.getId();
		
		//IF we already have that id
		if (this.incomingStreamTracks.has(uuid))
			//Launch exception
			throw new Error("Duplicated track id");
		
		//Create source map
		const sources: NativeSourceMap = {};

		try 
		{
			//For each encoding source found on track info
			for (const encodingSource of trackInfo.getEncodingSources())
			{
				//Create native source
				const source = SharedPointer.SharedPointer(new Native.RTPIncomingSourceGroupShared(
					Utils.mediaToFrameType(media),
					this.transport.GetTimeService())
				);

				//Set ids
				source.mid	= trackInfo.getMediaId() ?? "";
				source.rid	= encodingSource.rid	 ?? "";

				//If using rid mechanism
				if (source.rid)
				{
					//Allow ssrc-less tracks
					source.media.ssrc	= encodingSource.media ?? 0;
					source.rtx.ssrc		= encodingSource.rtx ?? 0;
					//source.fec.ssrc		= encodingSource.fec ?? 0;
				} else {
					//Set source ssrcs
					source.media.ssrc	= encodingSource.media ?? this.lfsr.seq(31);
					//Only allow rtx/fec for video for now
					if (media == "video")
					{
						source.rtx.ssrc	= encodingSource.rtx	?? this.lfsr.seq(31);
						//source.fec.ssrc= encodingSource.fec	?? this.lfsr.seq(31);
					}
				}
			
				if (!this.transport.AddIncomingSourceGroup(source))
					//Launch exception
					throw new Error("Could not add incoming source group to native transport");
				
				//Add to sources
				sources[encodingSource.id!] = source;
			}
		} catch (e) {
			//For each source
			for (const id of Object.keys(sources))
				//Remove source group
				this.transport.RemoveIncomingSourceGroup(sources[id]);
			//Rethrow exception
			throw e;
		}
		 
		//Create new track
		const incomingStreamTrack = new IncomingStreamTrack(
			media,
			trackInfo.getId(),
			trackInfo.getMediaId(),
			this.transport.GetTimeService(),
			SharedPointer.SharedPointer(this.transport.toRTPReceiver()),
			sources
		);

		//Add listener
		incomingStreamTrack.once("stopped",()=>{
			//For each source
			for (const id of Object.keys(sources))
				//Remove source group
				this.transport.RemoveIncomingSourceGroup(sources[id]);
			//Remove from tracks
			this.incomingStreamTracks.delete(uuid);
		});
		
		//Add to the track list
		this.incomingStreamTracks.set(uuid,incomingStreamTrack);

		//Add it to the stream
		if (incomingStream) incomingStream.addTrack(incomingStreamTrack)
		
		//Emit new track event
		this.emit("incomingtrack", incomingStreamTrack, incomingStream);
			
		//Return it
		return incomingStreamTrack;
	}
	
	/**
	 * Create new outgoing stream and attach to the incoming stream
	 * @param {IncomingStream} incomingStream the incoming stream to be published in this transport
	 * @returns {OutgoingStream} The new outgoing stream
	 */
	publish(incomingStream: IncomingStream): OutgoingStream
	{
		//Create new incoming stream
		let outgoingStream = this.createOutgoingStream ({
			audio: incomingStream.getAudioTracks().map(t => ({ id: t.getId(), media: t.getMedia() })),
			video: incomingStream.getVideoTracks().map(t => ({ id: t.getId(), media: t.getMedia() })),
		});
		
		//Attach the streams
		outgoingStream.attachTo(incomingStream);
		
		//return the new created stream
		return outgoingStream;
	}
	
	/**
	 * Stop transport and all the associated incoming and outgoing streams
	 */
	stop(): void
	{
		//Don't call it twice
		if (this.stopped) return;

		//Mark as stopped
		this.stopped = true;
		
		//Stop all streams
		for (let stream of this.incomingStreams.values()) {
			stream.stop();
		}

		//Stop all streams
		for (let stream of this.outgoingStreams.values()) {
			stream.stop();
		}

		//Clear maps jic
		this.incomingStreams.clear();
		this.outgoingStreams.clear();
		
		//Stop all tracks
		for (let track of this.incomingStreamTracks.values()) {
			track.stop();
		}

		//Stop all tracks
		for (let track of this.outgoingStreamTracks.values()) {
			track.stop();
		}

		//Clear maps jic
		this.incomingStreamTracks.clear();
		this.outgoingStreamTracks.clear();

		//Remove dtls listener
		//@ts-expect-error
		this.transport.SetListener(null);
		
		//Remove transport/connection from bundle, DO NOT USE them later on
		this.bundle.RemoveICETransport(this.username);

		//Stop listening for events, as they might have been queued
		this.ontargetbitrate = noop;
		this.ondtlsstate = noop;
		this.onicetimeout = noop;
		this.onremoteicecandidate = noop;

		//No state yet
		this.dtlsState = "closed";
		
		this.emit("stopped",this);
		
		//Stop emitter
		super.stop();

		//Remove transport reference, so destructor is called on GC
		//@ts-expect-error
		this.username = null;
		//@ts-expect-error
		this.connection = null;
		//@ts-expect-error
		this.transport = null;
		//@ts-expect-error
		this.senderSideListener = null;
		//@ts-expect-error
		this.listener = null;
		//@ts-expect-error
		this.bundle = null;
	}
}
