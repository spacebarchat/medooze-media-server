import * as NetworkUtils from "./NetworkUtils";
import * as Native from "./Native";
import Emitter from "medooze-event-emitter";
import {Transport} from "./Transport";
import {PeerConnectionServer} from "./PeerConnectionServer";
import {SDPManager} from "./SDPManager";
import {SDPManagerUnified} from "./SDPManagerUnified";
import {SDPManagerPlanB} from "./SDPManagerPlanB";
import {IncomingStream} from "./IncomingStream";
import {IncomingStreamTrackMirrored} from "./IncomingStreamTrackMirrored";
import {IncomingStreamTrack} from "./IncomingStreamTrack";
import {OutgoingStream} from "./OutgoingStream";
import {OutgoingStreamTrack} from "./OutgoingStreamTrack";
import {ActiveSpeakerMultiplexer} from "./ActiveSpeakerMultiplexer";
import { CandidateInfo, CandidateInfoLike, Capabilities, DTLSInfo, DTLSInfoLike, ICEInfo, ICEInfoLike, SDPInfo, Setup, StreamInfoLike } from "semantic-sdp";

const assertUnreachable = (x: never): never => { throw new Error('assertion failed') };

/** Dictionary with transport properties */
export interface CreateTransportOptions {
	/** Disable ICE/STUN keep alives, required for server to server transports */
    disableSTUNKeepAlive?: boolean;
	/** Colon delimited list of SRTP protection profile names */
    srtpProtectionProfiles?: string;
	/** Override BWE reported by REMB */
    overrideBWE?: boolean;
	/** Disable REMB BWE calculation. */
    disableREMB?: boolean;
	/** Preffer setting local DTLS setup to 'active' if remote is 'actpass'. */
    prefferDTLSSetupActive?: boolean;
}

export interface PeerInfo {
	/** ICE info, containing the username and password */
    ice: ICEInfoLike;
	/** DTLS info */
    dtls: DTLSInfoLike;
	/** ICE candidates list (for local info, it's not really used at all) */
    candidates?: CandidateInfoLike[];
}

export interface ParsedPeerInfo {
    ice: ICEInfo;
    dtls: DTLSInfo;
    candidates: CandidateInfo[];
}

export interface CreateOfferParameters {
	/** Generate unified plan like media ids */
    unified?: boolean;
	/** Add the stream infos to the generated offer */
    streams?: StreamInfoLike[];
}


function parsePeerInfo(info: PeerInfo | SDPInfo): ParsedPeerInfo
{
	let peerInfo: PeerInfo;

	//Support both plain js object and SDPInfo
	if (info instanceof SDPInfo) {
		//Convert
		peerInfo = {
			dtls		: info.getDTLS(),
			ice		: info.getICE(),
			candidates	: info.getCandidates()
		};
	} else {
		peerInfo = info;
	}

	//Ensure that we have the correct params
	if (!info || !info.ice || !info.dtls)
		//Error
		throw new Error("No ICE or DTLS info provided");
	
	//Create remote properites
	return {
		dtls		: DTLSInfo.clone(peerInfo.dtls),
		ice		: ICEInfo.clone(peerInfo.ice),
		candidates	: (peerInfo.candidates || []).map(CandidateInfo.clone),
	};
}

export interface RawTxOptions {
	/** (required) name of interface to send on */
    interfaceName: string;
	/** whether to skip the traffic shaping (qdisc) on the interface */
    skipQdisc?: boolean;
	/** AF_PACKET socket send queue */
    sndBuf?: number;
}

export interface NativeBundle extends Native.RTPBundleTransport {
    rawTxInterface?: number;
}

interface EndpointEvents {
    stopped: (self: Endpoint) => void;
}

/**
 * An endpoint represent an UDP server socket.
 * The endpoint will process STUN requests in order to be able to associate the remote ip:port with the registered transport and forward any further data comming from that transport.
 * Being a server it is ICE-lite.
 */
export class Endpoint extends Emitter<EndpointEvents>
{
	ips: string[];
    bundle: NativeBundle;
    transports: Set<Transport>;
    candidates: CandidateInfo[];
    defaultSRTPProtectionProfiles: string;
    fingerprint: string;
    stopped: boolean;

	mirrored: {
        streams: WeakMap<IncomingStream, IncomingStream>;
        tracks: WeakMap<IncomingStreamTrack, IncomingStreamTrackMirrored>;
        mirrors: Set<IncomingStream | IncomingStreamTrackMirrored>;
    };

	constructor(ip: string | string[], packetPoolSize = 0)
	{
		//Init emitter
		super();

		//Store ip address of the endpoint
		this.ips = Array.isArray(ip) ? ip : [ip];
		//Create native endpoint
		this.bundle = new Native.RTPBundleTransport(packetPoolSize);
		//Start it
		if (!this.bundle.Init())
			//Throw errror
			throw new Error("Could not initialize bundle for endpoint");
		//Store all transports
		this.transports = new Set<Transport>();
		//Create candidates 
		this.candidates = [];
		//Default
		this.defaultSRTPProtectionProfiles = "";
		this.stopped = false;
		//Create candidates
		for (let i=0; i<this.ips.length; i++) 
		{
			//Calculate priority in descending order
			let priority = Math.pow(2,24)*126 + Math.pow(2,8)*(65535-i) + 255;
			//Add new RTP UPD local candidate
			this.candidates.push(new CandidateInfo("1", 1, "UDP", priority, this.ips[i], this.bundle.GetLocalPort(), "host"));
		}
		//Get fingerprint (global at media server level currently)
		this.fingerprint = Native.MediaServer.GetFingerprint().toString();

		//Mirrored streams and tracks
		this.mirrored = {
            streams: new WeakMap<IncomingStream, IncomingStream>(),
            tracks: new WeakMap<IncomingStreamTrack, IncomingStreamTrackMirrored>(),
            mirrors: new Set<IncomingStream | IncomingStreamTrackMirrored>(),
        };
	}
	
	/**
	 * Set cpu affinity for udp send/recv thread.
	 * @param {Number}  cpu - CPU core or -1 to reset affinity.
	 * @returns {boolean} true if operation was successful
	 */
	setAffinity(cpu: number): boolean
	{
		//Set cpu affinity
		return this.bundle.SetAffinity(cpu);
	}

	/** 
	 * setDefaultSRTProtectionProfiles
	 * @param {String} srtpProtectionProfiles - Colon delimited list of SRTP protection profile names
	 */
	 setDefaultSRTProtectionProfiles(srtpProtectionProfiles: string): void
	 {
		this.defaultSRTPProtectionProfiles = srtpProtectionProfiles;
	 }

	/**
	 * [EXPERIMENTAL] See TypeScript typings for usage.
	 *
	 * @param {false | RawTxOptions} options Options for raw TX. Pass false to disable.
	 */
	async setRawTx(options: false | RawTxOptions): Promise<void>
	{
		// if false was passed, disable raw TX sending
		if (options === false) {
			this.bundle.ClearRawTx();
			delete this.bundle.rawTxInterface;
			return;
		}
		// gather necessary information and pass it to the bundle
		const config = await NetworkUtils.getInterfaceRawConfig(options.interfaceName);
		const port = this.getLocalPort();
		this.bundle.SetRawTx(
			config.index, options.sndBuf || 0, !!options.skipQdisc,
			config.lladdr, ...config.defaultRoute, port,
		);
		this.bundle.rawTxInterface = config.index;
	}

	/**
	 * Set name for udp send/recv thread.
	 *
	 * Useful for debugging or tracing. Currently only supported
	 * on Linux, fails on other platforms.
	 * Length is limited to 16 bytes.
	 * @param {String}  name - thread name to set
	 * @returns {boolean} true if operation was successful
	 */
	setThreadName(name: string): boolean
	{
		return this.bundle.SetThreadName(name);
	}

	/**
	 * Set thread priority for udp send/recv thread.
	 * NOTE: User needs to have the appropiate rights to increase the thread priority in ulimit
	 * @param {Number}  priority - 0:Normal -19:RealTime
	 * @returns {boolean} true if operation was successful
	 */
	setPriority(priority: number): boolean
	{
		//Set cpu affinity
		return this.bundle.SetPriority(priority);
	}
	
	/**
	 * Set ICE timeout for outgoing ICE binding requests
	 * @param {Number}  timeout - Ammount of time in milliseconds between ICE binding requests 
	 */
	setIceTimeout(timeout: number): void
	{
		//Set it
		return this.bundle.SetIceTimeout(timeout);
	}

	/**
	 * Get port at which UDP socket is bound
	 */
	getLocalPort(): number
	{
		return this.bundle.GetLocalPort()
	}
	
	/**
	 * Create a new transport object and register it with the remote ICE username and password
	 * @param {SemanticSDP.SDPInfo | PeerInfo} remoteInfo Remote ICE and DTLS properties
	 * @param {SemanticSDP.SDPInfo | PeerInfo} [localInfo] Local ICE and DTLS properties
	 * @param {CreateTransportOptions} [options]
	 * @returns {Transport}	New transport object
	 */
	createTransport(
        remoteInfo: SDPInfo | PeerInfo, 
        localInfo?: SDPInfo | PeerInfo, 
        options?: CreateTransportOptions
    ): Transport
	{
		//Check we have a transport already
		if (!this.bundle)
			//Error
			throw new Error("Endpoint is already stopped, cannot create transport");
		
		const remote = parsePeerInfo(remoteInfo);
		
		//If there is no local info, generate one
		const local = parsePeerInfo(localInfo || {
			ice		: ICEInfo.generate(true),
			dtls		: new DTLSInfo(Setup.reverse(remote.dtls.getSetup(),  options?.prefferDTLSSetupActive), "sha-256", this.fingerprint),
			candidates	: this.candidates
		});
		
		//Set lite nd end of candidates to ICE info
		local.ice.setLite(true);
		local.ice.setEndOfCandidates(true);

		//Create native tranport and return wrapper
		const transport = new Transport(this.bundle, remote, local, Object.assign({
				 disableSTUNKeepAlive	: false,
				 srtpProtectionProfiles : this.defaultSRTPProtectionProfiles
			}, options)
		);
		
		//Store it
		this.transports.add(transport);
		
		//Add us to ended
		transport.once("stopped", (transport) => {
			//Remove transport from set
			this.transports.delete(transport);
		});
		
		//Done
		return transport;
	}
	/**
	 * Get local ICE candidates for this endpoint. It will be shared by all the transport associated to this endpoint.
	 * @returns {Array<CandidateInfo>}
	 */
	getLocalCandidates(): CandidateInfo[] 
	{
		//Return local host candiadate as array
		return this.candidates;
	}
	
	
	/**
	 * Get local DTLS fingerprint for this endpoint. It will be shared by all the transport associated to this endpoint.
	 * @returns {String}
	 */
	getDTLSFingerprint(): string
	{
		return this.fingerprint;
	}
	
	/**
	 * Helper that creates an offer from capabilities
	 * It generates a random ICE username and password and gets endpoint fingerprint
	 * @param {SemanticSDP.Capabilities} [capabilities] - Media capabilities as required by SDPInfo.create
	 * @param {CreateOfferParameters} [params]
	 * @returns {SDPInfo} - SDP offer
	 */
	createOffer(capabilities?: Capabilities, params?: CreateOfferParameters): SDPInfo
	{
		//Create offer
		return SDPInfo.create({
			dtls		: new DTLSInfo(Setup.ACTPASS,"sha-256",this.fingerprint),
			ice		: ICEInfo.generate(true),
			candidates	: this.getLocalCandidates(),
			capabilities	: capabilities,
			unified		: !!params?.unified,
			streams         : params?.streams,
		});
	}
	
	/**
	 * Create new peer connection server to manage remote peer connection clients
	 * @param {any} tm
	 * @param {SemanticSDP.Capabilities} capabilities - Same as SDPInfo.answer capabilities
	 * @param {CreateTransportOptions} options
	 * @returns {PeerConnectionServer}
	 */
	createPeerConnectionServer(tm: any,capabilities: Capabilities,options: CreateTransportOptions): PeerConnectionServer
	{
		//Create new one 
		return new PeerConnectionServer(this,tm,capabilities,options);
	}
	
	/**
	 * Create new active speaker multiplexer for given outgoing tracks
	 * @param {OutgoingStream|OutgoingStreamTrack[]} streamOrTracks - Outgoing stream or outgoing stream track array to be multiplexed
	 * @returns {ActiveSpeakerMultiplexer}
	 */
	createActiveSpeakerMultiplexer(streamOrTracks: OutgoingStream | OutgoingStreamTrack[]): ActiveSpeakerMultiplexer
	{
		return new ActiveSpeakerMultiplexer(this.bundle.GetTimeService(),streamOrTracks);
	}

	/**
	 * Mirror incoming stream from another endpoint. Used to avoid inter-thread synchronization when attaching multiple output streams.
	 * The endpoint will cache the cucrrent mirrored streams and return an already existing object if calling this method twice with same stream.
	 * @param {IncomingStream} incomingStream - stream to mirror
	 * @returns {IncomingStream} mirrored stream.
	 */
	mirrorIncomingStream(incomingStream: IncomingStream): IncomingStream
	{
		//Get mirrored track
		let mirroredStream = (this.mirrored.streams.get(incomingStream));
		
		//If not mirrored yet
		if (!mirroredStream)
		{
			//Create new stream
			mirroredStream = new IncomingStream(incomingStream.getId(), incomingStream.transport);
			
			//Add to map and mirror set
			this.mirrored.streams.set(incomingStream,mirroredStream);
			this.mirrored.mirrors.add(mirroredStream);
			
			//For each track 
			for (const incomingStreamTrack of incomingStream.getTracks())
			{
				//Create mirror track
				const mirroredStreamTrack = this.mirrorIncomingStreamTrack(incomingStreamTrack);
				//Add to mirrored stream
				mirroredStream.addTrack((mirroredStreamTrack as any));
			}
			
			//Listen for new tacks
			incomingStream.on("track",(incomingStream,incomingStreamTrack)=>{
				//Create mirror track
				const mirroredStreamTrack = this.mirrorIncomingStreamTrack(incomingStreamTrack);
				//Add to mirrored stream
				mirroredStream!.addTrack((mirroredStreamTrack as any));
			});
			
			// Listen for track removal
			incomingStream.on("trackremoved", (incomingStream, incomingStreamTrack) => {
				mirroredStream!.removeTrack(incomingStreamTrack.getId());
			});
			
			// Listen for track removal
			mirroredStream.on("trackremoved", (incomingStream, incomingStreamTrack) => {
				this.mirrored.tracks.delete(incomingStreamTrack);
				this.mirrored.mirrors.delete((incomingStreamTrack as any));
			});
			
			
			//Stop listener for original stream
			const onstopped = ()=>{
				//Stop mirror
				mirroredStream?.stop();
			};
			
			//Listen for stop event
			incomingStream.once("stopped",onstopped);
			
			//Delete from maps when stoped
			mirroredStream.once("stopped",()=>{
				//Remove references
				this.mirrored.streams.delete(incomingStream);
				this.mirrored.mirrors.delete(mirroredStream!);
				//Remove listener
				incomingStream.off("stopped",onstopped);
			});
		}
		//return mirror
		return mirroredStream;
	}
	
	/**
	 * Mirror incoming stream track from another endpoint. Used to avoid inter-thread synchronization when attaching multiple output tracks.
	 * The endpoint will cache the cucrrent mirrored tracks and return an already existing object if calling this method twice with same track.
	 * @param {IncomingStreamTrack} incomingStreamTrack - track to mirror
	 * @returns {IncomingStreamTrackMirrored} mirrored track.
	 */
	mirrorIncomingStreamTrack(incomingStreamTrack: IncomingStreamTrack): IncomingStreamTrackMirrored
	{
		//Get mirrored track
		let mirroredStreamTrack = /** @type {IncomingStreamTrackMirrored} */ (this.mirrored.tracks.get(incomingStreamTrack));
		
		//If not mirrored yet
		if (!mirroredStreamTrack)
		{
			//Create mirror track
			mirroredStreamTrack  = new IncomingStreamTrackMirrored(incomingStreamTrack,this.bundle.GetTimeService());
			//Add to track map and mirrors set
			this.mirrored.tracks.set(incomingStreamTrack,mirroredStreamTrack);
			this.mirrored.mirrors.add(mirroredStreamTrack);
			
			//Stop listener for original track
			const onstopped = ()=>{
				//Stop mirror
				mirroredStreamTrack!.stop();
			};
			//Listen for stop event
			incomingStreamTrack.once("stopped",onstopped);
			
			//Stop listener
			mirroredStreamTrack.once("stopped",()=>{
				//Remove references
				this.mirrored.tracks.delete(incomingStreamTrack);
				this.mirrored.mirrors.delete(mirroredStreamTrack!);
				//Remove listener
				incomingStreamTrack.off("stopped",onstopped);
			});
		}
		//return mirror
		return mirroredStreamTrack;
	}
	
	
	/**
	 * Create new SDP manager, this object will manage the SDP O/A for you and produce a suitable trasnport.
	 * @param {"unified-plan" | "plan-b"} sdpSemantics - Type of sdp plan
	 * @param {SemanticSDP.Capabilities} capabilities - Capabilities objects
	 * @returns {SDPManager}
	 */
	createSDPManager(sdpSemantics: "unified-plan" | "plan-b",capabilities: Capabilities): SDPManager
	{
		if (sdpSemantics=="plan-b")
			return new SDPManagerPlanB(this,capabilities);
		else if (sdpSemantics=="unified-plan")
			return new SDPManagerUnified(this,capabilities);
		//Unknown
		return assertUnreachable(sdpSemantics);
	}
	
	/**
	 * Stop the endpoint UDP server and terminate any associated transport
	 */
	stop()
	{
		//Don't call it twice
		if (this.stopped) return;

		//Mark as stopped
		this.stopped = true;
		
		//For each transport
		for (let transport of this.transports)
			//Stop it
			transport.stop();
		
		//For each mirrored stream or track
		for (let mirror of this.mirrored.mirrors)
			//Stop it
			mirror.stop();
		
		this.emit("stopped",this);
		
		//End bundle
		this.bundle.End();
		
		//Stop emitter
		super.stop();
		
		//Remove bundle reference, so destructor is called on GC
		//@ts-expect-error
		this.bundle = null;
	}
}
