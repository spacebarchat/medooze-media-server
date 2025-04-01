import * as Native from "./Native.js";
import {Endpoint} from "./Endpoint";
import {Streamer} from "./Streamer";
import {Recorder, RecorderParams} from "./Recorder";
import {Player} from "./Player";
import {ActiveSpeakerDetector} from "./ActiveSpeakerDetector";
import {Refresher} from "./Refresher";
import {EmulatedTransport} from "./EmulatedTransport";
import {IncomingStreamTrackSimulcastAdapter} from "./IncomingStreamTrackSimulcastAdapter";
import {IncomingStreamTrackReader} from "./IncomingStreamTrackReader";
import * as SharedPointer from "./SharedPointer.js";
import { SDPInfo, MediaInfo, CandidateInfo, DTLSInfo, ICEInfo, StreamInfo, TrackInfo, Setup, Capabilities } from "semantic-sdp";
//Sequence for init the other LFSR instances
import LFSR from 'lfsr';
import {IncomingStream} from "./IncomingStream.js";

const defaultSeed = new LFSR(8, 92914);

const endpoints	  = new Set<Endpoint | EmulatedTransport>();

//Replace default seeed
LFSR.prototype._defaultSeed = function(n: number) {
	if (!n) throw new Error('n is required');
	return defaultSeed.seq(n);
};

export namespace MediaServer {
	/**
	 * Set new DTLS certificates. Should be called before any Endpoint is established.
	 * @memberof MediaServer
	 * @param {String} cert - path of the certificate file
	 * @param {String} key - path of the key file
	 */
	export const setCertificate = function(cert: string,key: string)
	{
		//Ensure we have cert and key and set it
		if (!cert || !key || !Native.MediaServer.SetCertificate(cert,key))
			throw new Error('Could not set DTLS key and certificates');
	};

	/**
	* Get local DTLS fingerprint for this Media Server.
	* @returns {String}
	*/
	export const getDTLSFingerprint = function(): string
	{
		return Native.MediaServer.GetFingerprint().toString();
	}

	/**
	 * Close async handlers so nodejs can exit nicely
	 * Only call it once!
	 * @memberof MediaServer
	 */
	export const terminate = function()
	{
		//Stop all endpoints
		for (const endpoint of endpoints)
			endpoint.stop();
		
		//Set flag
		Native.MediaServer.Terminate();
	};
	
	/**
	 * Enable or disable warning level traces
	 * @memberof MediaServer
	 * @param {Boolean} flag
	 */
	export const enableWarning = function(flag: boolean)
	{
		//Set flag
		Native.MediaServer.EnableWarning(flag);
	};

	/**
	 * Enable or disable log level traces
	 * @memberof MediaServer
	 * @param {Boolean} flag
	 */
	export const enableLog = function(flag: boolean)
	{
		//Set flag
		Native.MediaServer.EnableLog(flag);
	};

	/**
	 * Enable or disable debug level traces
	 * @memberof MediaServer
	 * @param {Boolean} flag
	 */
	export const enableDebug = function(flag: boolean)
	{
		//Set flag
		Native.MediaServer.EnableDebug(flag);
	};

	/**
	 * Set UDP port range for encpoints
	 * @memberof MediaServer
	 * @param {Number} minPort - Min UDP port
	 * @param {Number} maxPort - Max UDP port [Optional]
	 */
	export const setPortRange = function(minPort: number,maxPort: number)
	{
		//Set flag
		return Native.MediaServer.SetPortRange(minPort,maxPort);
	};

	/**
	 * Set node uv loop cpu affinity
	 * @memberof MediaServer
	 * @param {Number} cpu - CPU core number
	 * @returns {boolean} true if operation was successful
	 */
	export const setAffinity = function(cpu: number): boolean
	{
		//Set flag
		return Native.MediaServer.SetAffinity(cpu);
	};

	/**
	 * Set node uv loop thread name.
	 *
	 * Useful for debugging or tracing. Currently only supported
	 * on Linux, fails on other platforms.
	 * Length is limited to 16 bytes.
	 * @param {String}  name - thread name to set
	 * @returns {boolean} true if operation was successful
	 */
	export const setThreadName = function(name: string): boolean
	{
		//Set flag
		return Native.MediaServer.SetThreadName(name);
	};

	/**
	 * Enable or disable ultra debug level traces
	 * @memberof MediaServer
	 * @param {Boolean} flag
	 */
	export const enableUltraDebug = function(flag: boolean)
	{
		//Set flag
		Native.MediaServer.EnableUltraDebug(flag);
	};

	/**
	 * Create a new endpoint object
	 * @memberof MediaServer
	 * @param {string | string[]} ip				- External IP address of server, to be used when announcing the local ICE candidate
	 * @param {EndpointParams} [params]
	 * @returns {Endpoint} The new created endpoing
	 */
	export const createEndpoint = function(ip: string | string[], params?: EndpointParams): Endpoint
	{
		//Cretate new rtp endpoint
		const endpoint = new Endpoint(ip, Number.isInteger(params?.packetPoolSize) ? params?.packetPoolSize : 0);
		
		//Add to endpoint set
		endpoints.add(endpoint);
		
		//Listen for stopped evetns
		endpoint.once("stopped",()=>{
			//Remove when stopped
			endpoints.delete(endpoint);
		});
		
		//Done
		return endpoint;
	};

	/**
	* Helper that creates an offer from capabilities
	* It generates a random ICE username and password and gets media server dtls fingerprint
	* @param {SemanticSDP.Capabilities} [capabilities] - Media capabilities as required by SDPInfo.create
	* @returns {SDPInfo} - SDP offer
	*/
	export const createOffer = function(capabilities?: Capabilities): SDPInfo
	{
		//Create offer
		return SDPInfo.create({
			dtls		: new DTLSInfo(Setup.ACTPASS,"sha-256", MediaServer.getDTLSFingerprint()),
			ice		: ICEInfo.generate(true),
			candidates	: [],
			capabilities	: capabilities
		});
	}

	/**
	* Create a new MP4 recorder
	* @memberof MediaServer
	* @param {String} filename - Path and filename of the recorded mp4 file
	* @param {Recorder.RecorderParams} [params]
	* @returns {Recorder}
	*/
	export const createRecorder = function(filename: string,params?: RecorderParams): Recorder
	{
		//Return recorder
		return new Recorder(filename,params);
	};

	/**
	* Create a new MP4 player
	* @memberof MediaServer
	* @param {String} filename - Path and filename of the mp4 file
	* @returns {Player}
	*/
	export const createPlayer = function(filename: string): Player
	{
		//Return player
		return new Player(filename);
	};

	/**
	* Create a new RTP streamer
	* @memberof MediaServer
	* @returns {Streamer}
	*/
	export const createStreamer = function(): Streamer
	{
		//Return streamer
		return new Streamer();
	};

	/**
	 * Create a new Active Speaker Detecrtor
	 */
	export const createActiveSpeakerDetector = function(): ActiveSpeakerDetector
	{
		return new ActiveSpeakerDetector();
	};

	/**
	 * Create a new stream refresher
	 * @param {number} period - Intra refresh period
	*/
	export const createRefresher = function(period: number)
	{
		//Return streamer
		return new Refresher(period);
	};

	/**
	 * Create a new incoming track reader
	 * @param {boolean} intraOnly - Intra frames only
	 * @param {number} minPeriod - Minimum period between frames
	*/
	export const createIncomingStreamTrackReader = function(intraOnly: boolean, minPeriod: number)
	{
		//Return streamer
		return new IncomingStreamTrackReader(intraOnly, minPeriod, false);
	};

	/**
	 * Create a new emulated transport from pcap file
	 * @param {String} pcap - PCAP filename and path
	*/
	export const createEmulatedTransport = function(pcap: string)
	{
		//Return emulated transport
		const endpoint =  new EmulatedTransport(pcap);
		
			//Add to endpoint set
		endpoints.add(endpoint);
		
		//Listen for stopped evetns
		endpoint.once("stopped",()=>{
			//Remove when stopped
			endpoints.delete(endpoint);
		});
		
		//Done
		return endpoint;
	};

	export const createIncomingStreamTrackSimulcastAdapter = function(trackId: string,mediaId: string,timeService?: Native.TimeService)
	{
		let loop: Native.EventLoop | null = null;
		if (!timeService)
		{
			//Create one event loop for this
			loop = new Native.EventLoop();
			//Start it
			loop.Start();
			
			timeService = loop;
		}
		
		//Create it
		const incomingStreamTrack = new IncomingStreamTrackSimulcastAdapter(trackId, mediaId, timeService);
		//Stop loop on track close if it is created here
		if (loop)
		{
			incomingStreamTrack.once("stopped",()=>loop?.Stop());
		}
		//Done
		return incomingStreamTrack;
	}

	export const createIncomingStreamSimulcastAdapter = (streamId: string, trackId: string, mediaId: string): IncomingStream => 
	{
		//Create transport-less stream
		const incomingStream = new IncomingStream(streamId,null);
		//Create track
		const incomingStreamTrack =  MediaServer.createIncomingStreamTrackSimulcastAdapter(trackId, mediaId);
		//Add track to stream
		incomingStream.addTrack((incomingStreamTrack as any));
		//Done
		return incomingStream;
	}
	
	export const createFrameDispatchCoordinator = (updateRefsPacketLateThresholdMs: number, 
		updateRefsStepPacketEarlyMs: number): SharedPointer.Proxy<Native.FrameDispatchCoordinatorShared> => 
	{
		return SharedPointer.SharedPointer(new Native.FrameDispatchCoordinatorShared(updateRefsPacketLateThresholdMs, updateRefsStepPacketEarlyMs));
	}

	/**
 * Get the default media server capabilities for each supported media type
 * @returns {SemanticSDP.Capabilities} Object containing the capabilities by media ("audio","video")
 */
export const getDefaultCapabilities = (): Capabilities =>
	{
		return {
			audio : {
				codecs		: ["opus","pcmu","pcma"],
				extensions	: [
					"urn:ietf:params:rtp-hdrext:ssrc-audio-level",
					"urn:ietf:params:rtp-hdrext:sdes:mid",
					"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
					"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"
				]
			},
			video : {
				codecs		: ["vp8","vp9","h264;packetization-mode=1","av1", "h265"],
				rtx		: true,
				simulcast	: true,
				rtcpfbs		: [
					{ "id": "goog-remb"},
					{ "id": "transport-cc"},
					{ "id": "ccm", "params": ["fir"]},
					{ "id": "nack"},
					{ "id": "nack", "params": ["pli"]}
				],
				extensions	: [
					"urn:3gpp:video-orientation",
					"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
					"urn:ietf:params:rtp-hdrext:sdes:mid",
					"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
					"urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
					"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"
				]
			}
		};
	};
}

/** Endpoint creation parameters */
interface EndpointParams {
	packetPoolSize: number
}
