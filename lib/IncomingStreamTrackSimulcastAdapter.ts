import * as Native from './Native';
import Emitter from 'medooze-event-emitter';
import * as SharedPointer from './SharedPointer';
import {ActiveLayersInfo, Encoding, IncomingStreamTrack, IncomingStreamTrackEvents, IncomingTrackStats} from './IncomingStreamTrack';
import { 
  TrackInfo, 
} from 'semantic-sdp';
import { SSRCs } from './Transport';
import { TrackType } from 'semantic-sdp/dist/TrackInfo';

/**
 * Bundle multiple video track as if they were a single simulcast video track
 * @extends {Emitter<IncomingStreamTrack.IncomingStreamTrackEvents<IncomingStreamTrackSimulcastAdapter, Encoding>>}
 */
export class IncomingStreamTrackSimulcastAdapter extends Emitter<IncomingStreamTrackEvents<IncomingStreamTrackSimulcastAdapter, Encoding>>
{
	public readonly id: string;
	public readonly media: 'video';
	public readonly mediaId: string;
	public muted: boolean;
	
	counter: number;
	trackInfo: TrackInfo;
	encodings: Map<string, Encoding>;
	encodingPerTrack: Map<IncomingStreamTrack, Map<string, Encoding>>;
	depacketizer: SharedPointer.Proxy<Native.SimulcastMediaFrameListenerShared>;
	stopped: boolean = false;

	constructor(
		id: string,
		mediaId: string,
		timeService: Native.TimeService)
	{
		//Init emitter
		super();

		//Store track id
		this.id = id;
		this.media = "video";
		this.mediaId = mediaId;
		//Not muted
		this.muted = false;

		//Attach counters
		this.counter	= 0;

		//Create info
		this.trackInfo = new TrackInfo(this.media, id);
	
		//Create source maps
		this.encodings = new Map();
		this.encodingPerTrack = new Map();

		//Create a simulcast frame listerner
		this.depacketizer = SharedPointer.SharedPointer(new Native.SimulcastMediaFrameListenerShared(timeService, 1, 0));
		
		// we have to bind `this` since this method will be called from event handler
		this.onStopped = this.onStopped.bind(this)
	}

	/** On stopped listener */
	private onStopped(incomingStreamTrack: IncomingStreamTrack) {
		//Remove track
		this.removeTrack(incomingStreamTrack);
	}

	/**
	 * Check if a track is present
	 * @param {IncomingStreamTrack} incomingStreamTrack
	 * @returns {Boolean}
	 */
	hasTrack(incomingStreamTrack: IncomingStreamTrack): boolean
	{
		return this.encodingPerTrack.has(incomingStreamTrack);
	}

	/**
	 * Add video track to the simulcast adapter
	 * @param {String} encodingId				- Id used as base for encodings id
	 * @param {IncomingStreamTrack} incomingStreamTrack	- Incoming video stream track
	 */
	addTrack(encodingId: string,incomingStreamTrack: IncomingStreamTrack)
	{
		//Ensure that it is not  already on the 
		if (this.encodingPerTrack.has(incomingStreamTrack))
			//Error
			throw Error("Cannot add track, it is already present");

		const encodings = /** @type {Map<string, Encoding>} */ (new Map());

		//Check incoming track mute state
		if (incomingStreamTrack.isMuted() != this.muted)
			//Set same mute state
			incomingStreamTrack.mute(this.muted);

		//For each encoding in the original track
		for (let encoding of incomingStreamTrack.getEncodings())
		{
			//Get mirror encoding
			const mirrored = {
				id		: encoding.id == "" ? String(encodingId) : String(encodingId) + "#" + encoding.id,
				source		: encoding.source,
				receiver	: encoding.receiver,
				depacketizer	: encoding.depacketizer
			};

			//check if we already have it
			if (this.encodings.has(mirrored.id)) {
				//Error
				throw new Error("Cannot add track, ncoding id already present");
			}
			//Push new encoding
			this.encodings.set(mirrored.id, mirrored);
			//Store ids
			encodings.set(encoding.id, mirrored);
			
			//Attach the simulcast depacketizer to the source media producer
			this.depacketizer.AttachTo(mirrored.depacketizer.toMediaFrameProducer());
		}

		//Update the number of layers
		this.depacketizer.SetNumLayers(this.encodings.size);

		//If we are already attached
		if (this.isAttached()) {
			//We have to signal as much times as counter
			for (let i= 0; i<this.counter; ++i) {
				//Signal original track is attached
				incomingStreamTrack.attached();
			}
		}
		//Set the stopped listener
		incomingStreamTrack.on("stopped",this.onStopped);

		//Add encodings to map
		this.encodingPerTrack.set(incomingStreamTrack,encodings);

		//Emit pending encoding events (it is important to defer this until now,
		//when the track is fully added and the new encodings we're emitting
		//are presented in getActiveLayers().
		for (const [id,encoding] of encodings) {
			this.emit("encoding",this,encoding);
		}
	}

	/**
	 * Remove video track to the simulcast adapter
	 * @param {IncomingStreamTrack} incomingStreamTrack	- Incoming video stream track
	 */
	removeTrack(incomingStreamTrack: IncomingStreamTrack)
	{
		//Get the encodings
		const encodings = this.encodingPerTrack.get(incomingStreamTrack);

		//Ensure we had that track
		if (!encodings)
			//Error
			throw new Error("Cannot remove track, track not present");

		//Remove all mirrored encoding ids
		for (const [id,encoding] of encodings)
		{
			//Remove track encodings
			this.encodings.delete(encoding.id);
			//Detach the simulcast depacketizer to the source media producer
			this.depacketizer.Detach(encoding.depacketizer.toMediaFrameProducer());
		}
		//Update the number of layers
		this.depacketizer.SetNumLayers(this.encodings.size);
		//Remove from map
		this.encodingPerTrack.delete(incomingStreamTrack);

		//Remove stop listeners
		incomingStreamTrack.off("stopped",this.onStopped);

		//If we are already attached
		if (this.isAttached()) {
			//We have to signal as much times as counter
			for (let i= 0; i<this.counter; ++i) {
				//Signal original track is dettached
				incomingStreamTrack.detached();
			}
		}
		//Emit pending encodingremoved events (it is important to defer this
		//until now, when the track is fully removed and the old encodings
		//we're emitting are no longer presented in getActiveLayers().
		for (const [id,encoding] of encodings) {
			this.emit("encodingremoved", this, encoding);
		}
	}

	/**
	 * Get stats for all encodings from the original track
	 * @returns {IncomingStreamTrack.TrackStats}
	 */
	getStats(): IncomingTrackStats
	{
		const stats: IncomingTrackStats = {};
		
		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
		{
			//Get stats tats
			const trackStats = track.getStats();

			//for all layers
			for (const [id,stat] of Object.entries(trackStats))
			{
				//Get the mirrored encoding for the id
				const encoding = encodings.get(id);

				if(!encoding) continue;

				//Add stat with mirrored id
				stats[encoding.id] = stat;
			}
		}

		//Update silmulcast index for layers
		IncomingStreamTrack.updateStatsSimulcastIndexAndCodec(stats);

		return stats;
	}

	/**
	 * Get stats for all encodings from the original track
	 * @returns {Promise<IncomingStreamTrack.TrackStats>}
	 */
	async getStatsAsync(): Promise<IncomingTrackStats>
	{
		const stats: IncomingTrackStats = {};
		
		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
		{
			//Get stats tats
			const trackStats = await track.getStatsAsync();

			//for all layers
			for (const [id,stat] of Object.entries(trackStats))
			{
				//Get the mirrored encoding for the id
				const encoding = encodings.get(id);

				if(!encoding) continue;

				//Add stat with mirrored id
				stats[encoding.id] = stat;
			}
		}

		//Update silmulcast index for layers
		IncomingStreamTrack.updateStatsSimulcastIndexAndCodec(stats);

		return stats;
	}
	
	/**
	 * Get active encodings and layers ordered by bitrate of the original track
	 */
	getActiveLayers(): ActiveLayersInfo
	{
		//Get track stats
		const stats = this.getStats();
		
		//Get active layers from stats
		return IncomingStreamTrack.getActiveLayersFromStats(stats);
	}

	/**
	 * Get active encodings and layers ordered by bitrate of the original track
	 */
	async getActiveLayersAsync(): Promise<ActiveLayersInfo>
	{
		//Get track stats
		const stats = await this.getStatsAsync();
		
		//Get active layers from stats
		return IncomingStreamTrack.getActiveLayersFromStats(stats);
	}

	/**
	* Get track id as signaled on the SDP
	*/
	getId(): string
	{
		return this.id;
	}

	/**
	* Get track media id (mid)
	*/
	getMediaId(): string
	{
		return this.mediaId;
	}
	
	/**
	 * Get track info object
	 */
	getTrackInfo(): TrackInfo
	{
		return this.trackInfo;
	}

	/**
	 * Return ssrcs associated to this track
	 * @returns {{ [encodingId: string]: import("./Transport").SSRCs }}
	 */
	getSSRCs()
	{
		const ssrcs: { [encodingId: string]: SSRCs } =  {};
		
		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
		{
			//Get ssrcs
			const trackSSRCs = track.getSSRCs();

			//for all layers
			for (const [id,encodingSSRCs] of Object.entries(trackSSRCs))
			{
				//Get the mirrored encoding for the id
				const encoding = encodings.get(id);

				if(!encoding) continue;

				//Add stat with mirrored id
				ssrcs[encoding.id] = encodingSSRCs;
			}
		}

		//Return the stats array
		return ssrcs;
	}
	
	/**
	* Get track media type
	*/
	getMedia(): TrackType
	{
		return this.media;
	}
	
	/**
	 * Get all track encodings
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @returns {Array<Encoding>} - encodings 
	 **/
	getEncodings(): Encoding[]
	{
		return Array.from(this.encodings.values());
	}

	/**
	 * Get encoding by id
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @param {String} encodingId	- encoding Id,
	 * @returns {Encoding | undefined}
	 **/
	getEncoding(encodingId: string): Encoding | undefined
	{
		return this.encodings.get(encodingId);
	}
	
	/**
	 * Get default encoding
	 * Internal use, you'd beter know what you are doing before calling this method
	 * @returns {Encoding}
	 **/
	getDefaultEncoding(): Encoding
	{
		return [...this.encodings.values()][0];
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
	mute(muting: boolean): void 
	{
		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
			//Mute it
			track.mute(muting);
		
		//If we are different
		if (this.muted!==muting)
		{
			//Store it
			this.muted = muting;
			this.emit("muted",this.muted);
		}
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
		if (this.stopped) return;

		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
			//Signal original track is attached
			track.attached();

		//Increase attach counter
		this.counter++;
		
		//If it is the first
		if (this.counter===1)
			this.emit("attached",this);
	}
	
	/** 
	 * Request an intra refres on all sources
	 */
	refresh()
	{
		//For each source
		for (let encoding of this.encodings.values()) {
			//Request an iframe on main ssrc
			encoding.receiver.SendPLI(encoding.source.GetMediaSSRC());
		}
	}
	
	/**
	 * Signal that this track has been detached.
	 * Internal use, you'd beter know what you are doing before calling this method
	 */
	detached(): void
	{
		//If we are already stopped
		if (this.stopped) return;

		//For each track
		for (const [track,encodings] of this.encodingPerTrack) {
			//Signal original track is deattached
			track.detached();
		}

		//Decrease attach counter
		this.counter--;
		
		//If it is the last
		if (this.counter===0) {
			this.emit("detached",this);
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

		//For each track
		for (const [track,encodings] of this.encodingPerTrack)
		{
			//Remove all mirrored encoding ids
			for (const [id,encoding] of encodings) {
				//Detach the simulcast depacketizer to the source media producer
				this.depacketizer.Detach(encoding.depacketizer.toMediaFrameProducer());
			}
			//Remove stop listeners
			track.off("stopped",this.onStopped);
			//If we are already attached
			if (this.isAttached()) {
				//We have to signal as much times as counter
				for (let i= 0; i<this.counter; ++i) {
					//Signal original track is dettached
					track.detached();
				}
			}
		}

		//Clear encoding maps
		this.encodingPerTrack.clear();

		//Stop global depacketizer
		if (this.depacketizer) this.depacketizer.Stop();

		this.emit("stopped",this);
		
		//Stop emitter
		super.stop();
		
		//remove encpodings
		this.encodings.clear();
	}

}
