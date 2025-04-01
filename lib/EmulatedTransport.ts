import * as Native from "./Native";
import Emitter from "medooze-event-emitter";
import LFSR from 'lfsr';
import {IncomingStream} from "./IncomingStream";
import * as Utils from "./Utils";
import {
    SDPInfo,
    StreamInfo,
} from "semantic-sdp";

interface PlayParams {
    start?: number;
}

interface EmulatedTransportEvents {
	stopped: (self: EmulatedTransport) => void;
}

/**
 * An emulated transport reads data from a unencrypted pcap file (typically from a transport dump), and acts like if it was a live transport from a remote peer.
 * You must create the incoming streams as signaled on the remote SDP as any incoming RTP with an unknown ssrc will be ignored. The emulated transport does not allow creating outgoing streams.
 */
export class EmulatedTransport extends Emitter<EmulatedTransportEvents>
{
	transport: Native.PCAPTransportEmulator;
    incomingStreams: Map<string, IncomingStream>;
    lfsr: LFSR;

	constructor(pcap: string | Native.UDPReader)
	{
		//Init emitter
		super();

		//Create native emulator
		this.transport = new Native.PCAPTransportEmulator();
		
		//Check if it is a path or a reader
		if (typeof pcap === "string") {
			//Open file
			this.transport.Open(pcap);
		} else {
			//Set reader
			this.transport.SetReader(pcap);
		}
		//List of streams
		this.incomingStreams = new Map();
		
		//Create new sequence generator
		this.lfsr = new LFSR();
	}
	
	/**
	 * Set remote RTP properties 
	 * @param {Utils.RTPProperties | SDPInfo} rtp
	 */
	setRemoteProperties(rtp: Utils.RTPProperties | SDPInfo)
	{
		//Get native properties
		let properties = Utils.convertRTPProperties(Utils.parseRTPProperties(rtp));
		//Set it
		this.transport.SetRemoteProperties(properties);
	}
	
	/**
	 * Create an incoming stream object from the media stream info objet
	 * @param {StreamInfo} info Contains the ids and ssrcs of the stream to be created
	 * @returns {IncomingStream} The newly created incoming stream object
	 */
	createIncomingStream(info: StreamInfo): IncomingStream
	{
		//We have to add the incmoing source for this stream
		// todo: figure out what this is actually supposed to pass
		// @ts-expect-error
		let incomingStream = new IncomingStream(info.id, this.transport);
		
		//Add to list
		this.incomingStreams.set(incomingStream.getId(),incomingStream);
		
		//Add listener
		incomingStream.once("stopped",() => {
			//Remove it
			this.incomingStreams.delete(incomingStream.getId());
		});
			
		//Return it
		return incomingStream;
	}
	
	/**
	 * Starts playback
	 * @param {Object} params	
	 * @param {number} params.start - Set start time
	 */
	play(params?: PlayParams)
	{
		//If we need to seek
		if (params && params.start) {
			//Seek
			return this.transport.Seek(params.start);
		}

		//Start playback
		return this.transport.Play();
	}
	
	/**
	 * Resume playback
	 */
	resume(): boolean
	{
		return this.transport.Play();
	}
	
	/**
	 * Pause playback
	 */
	pause(): boolean
	{
		return this.transport.Stop();
	}
	
	/**
	 * Start playback from given time
	 * @param {Number} time - in miliseconds
	 */
	seek(time: number): boolean
	{
		this.transport.Seek(time);
		
		return this.transport.Play();
	}
	
	/**
	 * Stop transport and all the associated incoming and outgoing streams
	 */
	stop(): void
	{
		//Don't call it twice
		if (!this.transport) return;
		
		//Stop all streams
		for (let stream of this.incomingStreams.values())
			//stop
			stream.stop();
		
		//Clear maps jic
		this.incomingStreams.clear();
		
		//Stop transort
		this.transport.Stop();
		
		this.emit("stopped",this);

		//Stop emitter
		super.stop();
		
		//Remove transport reference, so destructor is called on GC
		//@ts-expect-error
		this.transport = null;
	}
}
