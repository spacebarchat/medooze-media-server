import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";
import {IncomingStreamTrack} from "./IncomingStreamTrack";
import {OutgoingStreamTrack} from "./OutgoingStreamTrack";
import * as Utils from "./Utils";
import { MediaInfo } from "semantic-sdp";
import LFSR from 'lfsr';

export interface StreamerSessionOptions {
	/** Local parameters */
    local?: { port: number };
	/** Remote parameters */
    remote?: { ip: string, port: number };
	/** Disable sending rtcp */
    noRTCP?: number;
}

interface StreamerSessionEvents {
    stopped: (self: StreamerSession) => void;
}

/**
 * Represent the connection between a local udp port and a remote one. It sends and/or receive plain RTP data.
 * @extends {Emitter<StreamerSessionEvents>}
 */
export class StreamerSession extends Emitter<StreamerSessionEvents>
{
	lfsr: LFSR;
    session: SharedPointer.Proxy<Native.RTPSessionFacadeShared>;
    incoming: IncomingStreamTrack;
    outgoing: OutgoingStreamTrack;

    /**
     * @param media - Media information 
     * @param params - Optional session parameters
     */
    constructor(media: MediaInfo, params?: StreamerSessionOptions)
	{
		//Init emitter
		super();

		//Create new sequence generator
		this.lfsr = new LFSR();

		const mediaType = media.getType();
		if (mediaType === "application")
			throw new Error("application media not supported");

		//Create session
		this.session = SharedPointer.SharedPointer(new Native.RTPSessionFacadeShared(Utils.mediaToFrameType(mediaType)));
		//Set local params
		if (params && params.local && params.local.port)
			//Set it
			this.session.SetLocalPort(params.local.port);
		
		//Set remote params
		if (params && params.remote && params.remote.ip && params.remote.port)
			//Set them
			this.session.SetRemotePort(String(params.remote.ip), params.remote.port);
		
		//Create new native properties object
		let properties = new Native.Properties();

		//If we have media
		if (media)
		{
			let num = 0;
			//For each codec
			for (let codec of media.getCodecs().values())
			{
				//Item
				let item = "codecs."+num;
				//Put codec
				properties.SetStringProperty(item+".codec"	, String(codec.getCodec()));
				properties.SetIntegerProperty(item+".pt"	, codec.getType());
				//If it has rtx
				if (codec.rtx)
					//Set rtx
					properties.SetIntegerProperty(item+".rtx", codec.getRTX());
				//one more
				num++;
			}
			//Set length
			properties.SetIntegerProperty("codecs.length", num);
		}
		
		//Check if we have to disable RTCP
		if (params && !!params.noRTCP)
			//Disable it
			properties.SetBooleanProperty("properties.useRTCP"	, false);

		//Set ssrcs
		properties.SetIntegerProperty("ssrc"	, this.lfsr.seq(31));
		properties.SetIntegerProperty("ssrcRTX"	, this.lfsr.seq(31));

		//Init session
		this.session.Init(properties);
		
		//Create incoming and outgoing tracks
		this.incoming = new IncomingStreamTrack(mediaType, media.getType(), "", this.session.GetTimeService(), SharedPointer.SharedPointer(this.session.toRTPReceiver()), {'':SharedPointer.SharedPointer(this.session.GetIncomingSourceGroup())});
		this.outgoing = new OutgoingStreamTrack(mediaType, media.getType(), "", this.session.toRTPSender(), SharedPointer.SharedPointer(this.session.GetOutgoingSourceGroup())); 
		
		//Try to get h264 codec
		const h264 = media.getCodec("h264");
		
		//if it is h264 and has the sprop-parameter
		if (h264 && h264.hasParam("sprop-parameter-sets"))
			//Set h264 props
			this.incoming.setH264ParameterSets(h264.getParam("sprop-parameter-sets"));
		
		//Stop listeners
		this.incoming.once("stopped",()=>{
			//@ts-expect-error
			this.incoming = null;
		});
		this.outgoing.once("stopped",()=>{
			//@ts-expect-error
			this.outgoing = null;
		});
	}
	
	/**
	 * Get the local rtp/udp port
	 * @returns {Number} port number
	 */
	getLocalPort(): number
	{
		return this.session.GetLocalPort();
	}
	
	/**Set the rempte rtp/udp ip and port
	 * 
	 */
	setRemote(ip: string, port: number): void
	{
		//Set them
		this.session.SetRemotePort(String(ip),port);
	}
		
	
	/**
	 * Returns the incoming stream track associated with this streaming session
	 * @returns {IncomingStreamTrack}
	 */
	getIncomingStreamTrack(): IncomingStreamTrack
	{
		return this.incoming;
	}
	
	/**
	 * Returns the outgoing stream track associated with this streaming session
	 * @returns {OutgoingStreamTrack}
	 */
	getOutgoingStreamTrack(): OutgoingStreamTrack
	{
		return this.outgoing;
	}
	
	/**
	 * Closes udp socket and frees resources
	 */
	stop(): void
	{
		//Don't call it twice
		if (!this.session) return;
		
		//Stop tracks
		this.incoming && this.incoming.stop();
		this.outgoing && this.outgoing.stop();
		
		//End
		this.session.End();
		
		this.emit("stopped",this);
		
		//Stop emitter
		super.stop();
		
		//Remove transport reference, so destructor is called on GC
		(this as any).session = null;
	}
	
}