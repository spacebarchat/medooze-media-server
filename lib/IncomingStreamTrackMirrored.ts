import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";
import {ActiveLayersInfo, Encoding, IncomingStreamTrack, IncomingStreamTrackEvents, IncomingTrackStats} from "./IncomingStreamTrack";
import SemanticSDP, {
    SDPInfo,
    Setup,
    MediaInfo,
    CandidateInfo,
    DTLSInfo,
    ICEInfo,
    StreamInfo,
    TrackInfo,
    TrackEncodingInfo,
    SourceGroupInfo,
    TrackType
} from "semantic-sdp";
import { SSRCs } from "./Transport";

/**
 * this type is like {@link Encoding} except that `source` is renamed to a new `mirror`
 * property, and then the `source` property is instead backed by a `RTPIncomingMediaStreamMultiplexer`.
 */
interface EncodingMirrored {
    id: string;
    mirror: SharedPointer.Proxy<Native.RTPIncomingSourceGroupShared>;
    source: SharedPointer.Proxy<Native.RTPIncomingMediaStreamMultiplexerShared>;
    receiver: SharedPointer.Proxy<Native.RTPReceiverShared>;
    depacketizer: SharedPointer.Proxy<Native.RTPIncomingMediaStreamDepacketizerShared>;
}


/**
 * Mirror incoming stream from another endpoint. Used to avoid inter-thread synchronization when attaching multiple output streams.
 */
export class IncomingStreamTrackMirrored extends Emitter<IncomingStreamTrackEvents<IncomingStreamTrackMirrored, EncodingMirrored>>
{
	track: IncomingStreamTrack;
    receiver: SharedPointer.Proxy<Native.RTPReceiverShared>
    muted: boolean;
    counter: number;
    encodings: Map<string, EncodingMirrored>;
    stopped: boolean;

	constructor(
		incomingStreamTrack: IncomingStreamTrack,
		timeService: Native.TimeService)
	{
		//Init emitter
		super();

		//Store original track and receiver
		this.track	= incomingStreamTrack;
		this.receiver	= incomingStreamTrack.receiver;
		//Not muted
		this.muted = false;
		//Attach counter
		this.counter	= 0;
		this.stopped = false;

		//Create source map
		this.encodings = new Map();

		//Internal function for adding a new mirrored encoding to the track
		const addEncoding = (encoding: Encoding) => {
			//Check if we had already an encoding for it (i.e. in case of SimulcastAdapter adding and removing a trac)
			const old = this.encodings.get(encoding.id);

			//If we had it
			if (old)
			{
				//Stop multiplexer source
				old.source.Stop();
				//Stop the depacketizer
				old.depacketizer.Stop();
			}

			//Create mirrored source
			const source = SharedPointer.SharedPointer(new Native.RTPIncomingMediaStreamMultiplexerShared(encoding.source.toRTPIncomingMediaStream(), timeService));

			//Get mirror encoding
			const mirrored = {
				id		: encoding.id,
				source		: source,
				mirror		: encoding.source,
				receiver	: encoding.receiver,
				depacketizer	: SharedPointer.SharedPointer(new Native.RTPIncomingMediaStreamDepacketizerShared(source.toRTPIncomingMediaStream()))
			};

			//Push new encoding
			this.encodings.set(mirrored.id, mirrored);

			return mirrored;
		}

		//For each encoding in the original track
		for (let encoding of incomingStreamTrack.encodings.values()) {
			//Add new encoding
			addEncoding(encoding);
		}

		//LIsten for new encodings
		incomingStreamTrack.prependListener("encoding",(incomingStreamTrack,encoding) => {
			//Add new encoding
			const mirrored = addEncoding(encoding);
			//Emit new event up
			this.emit("encoding", this, mirrored);
		});
		incomingStreamTrack.on("encodingremoved",(incomingStreamTrack,encoding) => {
			//Get mirrored encoder
			const mirrored = this.encodings.get(encoding.id);
			//If found
			if (mirrored)
			{
				//Stop multiplexer source
				mirrored.source.Stop();
				//Stop the depacketizer
				mirrored.depacketizer.Stop();				

				//Remove from encodings
				this.encodings.delete(encoding.id);
				//Fire event
				this.emit("encodingremoved", this, mirrored);
			}
		});

		//Listen for track stop event
		incomingStreamTrack.once("stopped",()=>{
			//Stop when the mirror is stopped too
			this.stop();
		});
	}
	
	/**
	 * Get stats for all encodings from the original track
	 */
	getStats(): IncomingTrackStats
	{
		return this.track.getStats();
	}
	
	/**
	 * Get stats for all encodings from the original track
	 */
	async getStatsAsync(): Promise<IncomingTrackStats>
	{
		return this.track.getStatsAsync();
	}

	/**
	 * Get active encodings and layers ordered by bitrate of the original track
	 */
	getActiveLayers(): ActiveLayersInfo
	{
		return this.track.getActiveLayers();
	}

	/**
	 * Get active encodings and layers ordered by bitrate of the original track
	 */
	async getActiveLayersAsync(): Promise<ActiveLayersInfo>
	{
		return this.track.getActiveLayersAsync();
	}

	/**
	* Get track id as signaled on the SDP
	*/
	getId(): string
	{
		return this.track.getId();
	}
	

	/**
	* Get track media id (mid)
	*/
	getMediaId(): string
	{
		return this.track.getMediaId();
	}
	
	/**
	 * Get track info object
	 * @returns {TrackInfo} Track info
	 */
	getTrackInfo(): TrackInfo
	{
		return this.track.getTrackInfo();
	}
	/**
	 * Return ssrcs associated to this track
	 */
	getSSRCs(): { [encodingId: string]: SSRCs }
	{
		return this.track.getSSRCs();
	}
	
	/**
	* Get track media type
	* @returns {SemanticSDP.TrackType}
	*/
	getMedia(): TrackType
	{
		return this.track.getMedia();
	}
	
	/**
	 * Get all track encodings
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @returns {Array<EncodingMirrored>} - encodings 
	 **/
	getEncodings(): EncodingMirrored[]
	{
		return Array.from(this.encodings.values());
	}

	/**
	 * Get encoding by id
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @param {String} encodingId	- encoding Id,
	 * @returns {EncodingMirrored | undefined}
	 **/
	getEncoding(encodingId: string): EncodingMirrored | undefined
	{
		return this.encodings.get(encodingId);
	}
	
	/**
	 * Get default encoding
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @returns {EncodingMirrored | undefined}
	 **/
	getDefaultEncoding(): EncodingMirrored | undefined
	{
		//Get original default encoding
		const original = this.track.getDefaultEncoding();
		//Return mirrored one
		return original ? this.getEncoding(original.id) : undefined;
	}

	/**
	 * Return if the track is attached or not
	 */
	isAttached(): boolean
	{
		return this.counter>0;
	}

	/**
	 * Signal that this track has been attached.
	 * Internal use, you'd beter know what you are doing before calling this method
	 */
	attached(): void 
	{
		//If we are already stopped
		if (!this.track) return;

		//Signal original track is attached
		this.track.attached();

		//Increase attach counter
		this.counter++;
		
		//If it is the first
		if (this.counter===1)
			this.emit("attached",this);
	}
	
	/** 
	 * Request an intra refres on all sources
	 */
	refresh(): void
	{
		//For each source
		for (let encoding of this.encodings.values()) {
			//Request an iframe on main ssrc
			encoding.receiver.SendPLI(encoding.mirror.media.ssrc);
		}
	}
	
	/**
	 * Signal that this track has been detached.
	 * Internal use, you'd beter know what you are doing before calling this method
	 */
	detached(): void
	{
		//If we are already stopped
		if (!this.track) return;

		//Signal original track is deattached
		this.track.detached();

		//Decrease attach counter
		this.counter--;
		
		//If it is the last
		if (this.counter===0)
			this.emit("detached",this);
	}

	/**
	 * Check if the track is muted or not
	 * @returns {boolean} muted
	 */
	isMuted(): boolean
	{
		return this.muted;
	}

	/**
	 * Mute/Unmute track
	 * @param {boolean} muting - if we want to mute or unmute
	 */
	mute(muting: boolean) : void
	{
		//For each source
		for (let encoding of this.encodings.values())
		{
			//Mute encoding
			encoding.source.Mute(muting);
			//If unmuting
			if (!muting)
				//Request an iframe on main ssrc
				encoding.receiver.SendPLI(encoding.mirror.media.ssrc);
		}
		
		//If we are different
		if (this.muted!==muting)
		{
			//Store it
			this.muted = muting;
			this.emit("muted",this.muted);
		}
	}
	
	/**
	 * Removes the track from the incoming stream and also detaches any attached outgoing track or recorder
	 */
	stop(): void
	{
		//Don't call it twice
		if (this.stopped) return;

		//Stopped
		this.stopped = true;
		
		//for each mirrored encoding
		for (let encoding of this.encodings.values())
		{
			//Stop multiplexer source
			encoding.source.Stop();
			//Stop the depacketizer
			encoding.depacketizer.Stop();
		}

		this.emit("stopped",this);
		
		//remove encpodings
		this.encodings.clear();

		//Stop emitter
		super.stop();
		
		//Remove track reference
		//@ts-expect-error
		this.track = null;
		//@ts-expect-error
		this.receiver = null;
	}
}
