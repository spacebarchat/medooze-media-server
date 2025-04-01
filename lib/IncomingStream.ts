import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";
import {
	StreamInfo,
	TrackType,
	TrackInfoLike} from "semantic-sdp";
import { IncomingStreamTrack, IncomingTrackStats } from "./IncomingStreamTrack";
import {Transport} from "./Transport";

interface IncomingStreamEvents {
    stopped: (self: IncomingStream, stats: ReturnType<IncomingStream['getStats']>) => void;
    attached: (self: IncomingStream) => void;
    detached: (self: IncomingStream) => void;
    muted: (muted: boolean) => void;
	/** IncomingStreamTrack added to stream */
    track: (self: IncomingStream, track: IncomingStreamTrack) => void;
	/** IncomingStreamTrack removed from stream */
    trackremoved: (self: IncomingStream, track: IncomingStreamTrack) => void;
}

/**
 * The incoming streams represent the recived media stream from a remote peer.
 */
export class IncomingStream extends Emitter<IncomingStreamEvents>
{
	id: string;
    info: StreamInfo;
    transport: Transport | null;
    muted: boolean;
    counter: number;
    tracks: Map<string, IncomingStreamTrack>;
    stopped?: boolean;

	constructor(id: string, transport: Transport | null)
	{
		super();

		this.id = id;
        this.info = new StreamInfo(id);
        this.transport = transport;
        this.muted = false;
        this.counter = 0;
        this.tracks = new Map<string, IncomingStreamTrack>();
		
		// bind `this` since these functions will be called by event handlers
		this.onTrackAttached = this.onTrackAttached.bind(this)
        this.onTrackDetached = this.onTrackDetached.bind(this)
        this.onTrackStopped = this.onTrackStopped.bind(this)
	}

	private onTrackAttached() {
		this.counter++;
		if (this.counter === 1)
			this.emit("attached", this);
	}

	private onTrackDetached() {
		this.counter--;
		if (this.counter === 0)
			this.emit("detached", this);
	}

	private onTrackStopped(incomingStreamTrack: IncomingStreamTrack) {
		this.tracks.delete(incomingStreamTrack.getId());
	}
	
	/**
	 * The media stream id as announced on the SDP
	 */
	getId() : string
	{
		return this.id;
	}
	
	/**
	 * Get the stream info object for signaling the ssrcs and stream info on the SDP from the remote peer
	 * @returns {StreamInfo} The stream info object
	 */
	getStreamInfo(): StreamInfo
	{
		//Create new stream info
		const info = new StreamInfo(this.id);
		//For each track
		for (const [trackId,track] of this.tracks) {
			//Append
			info.addTrack(track.getTrackInfo().clone());
		}
		//Return it
		return info;
	}

	/**
	 * Get statistics for all tracks in the stream
	 * 
	 * See {@link IncomingStreamTrack.getStats} for information about the stats returned by each track.
	 * 
	 * @returns {}
	 */
	getStats(): { [trackId: string]: IncomingTrackStats }
	{
		const stats: { [trackId: string]: IncomingTrackStats } = {};
		
		//for each track
		for (let track of this.tracks.values()) {
			//Append stats
			stats[track.getId()] = track.getStats();
		}

		return stats;
	}

	/**
	 * Get statistics for all tracks in the stream
	 * 
	 * See {@link IncomingStreamTrack.getStats} for information about the stats returned by each track.
	 */
	async getStatsAsync(): Promise<{ [trackId: string]: IncomingTrackStats }> 
	{
		// construct a list of promises for each [track ID, track stats] entry
		const promises = this.getTracks().map(async track => (
			[ track.getId(), await track.getStatsAsync() ]));

		// wait for all entries to arrive, then assemble the object from the entries
		return Object.fromEntries(await Promise.all(promises));
	}

	/**
	 * Check if the stream is muted or not
	 * @returns {boolean} muted
	 */
	isMuted(): boolean
	{
		return this.muted;
	}
	
	/**
	 * Mute/Unmute this stream and all the tracks in it
	 * @param {boolean} muting - if we want to mute or unmute
	 */
	mute(muting: boolean): void 
	{
		//For each track
		for (const track of this.tracks.values()) {
			//Mute track
			track.mute(muting);
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
	 * Get track by id
	 * @param {String} trackId	- The track id
	 * @returns {IncomingStreamTrack | undefined}	- requested track or null
	 */
	getTrack(trackId: string): IncomingStreamTrack | undefined {
        return this.tracks.get(trackId);
    }
	
	/**
	 * Get all the tracks
	 * @param {"audio" | "video"} [type]	- The media type (Optional)
	 * @returns {Array<IncomingStreamTrack>}	- Array of tracks
	 */
	getTracks(type?: "audio" | "video"): IncomingStreamTrack[] 
	{
        const tracks = Array.from(this.tracks.values());
        return type ? tracks.filter(track => track.getMedia().toLowerCase() === type) : tracks;
    }
	
	/**
	 * Get an array of the media stream audio tracks
	 * @returns {Array<IncomingStreamTrack>}	- Array of tracks
	 */
	getAudioTracks(): IncomingStreamTrack[] {
		return Array.from(this.tracks.values()).filter(track => 
            track.getMedia().toLowerCase() === "audio"
        );
	}
	
	/**
	 * Get an array of the media stream video tracks
	 * @returns {Array<IncomingStreamTrack>}	- Array of tracks
	 */
	getVideoTracks(): IncomingStreamTrack[] {
        return Array.from(this.tracks.values()).filter(track => 
            track.getMedia().toLowerCase() === "video"
        );
    }
	
	/**
	 * Adds an incoming stream track created using {@link Transport.createIncomingStreamTrack} to this stream
	 */
	addTrack(incomingStreamTrack: IncomingStreamTrack): void
	{
		//Ensure we don't have that id alread
		if (this.tracks.has(incomingStreamTrack.getId()))
			//Error
			throw new Error("Track id already present in stream");

		//If the track is already attached
		if (incomingStreamTrack.isAttached())
		{
			this.onTrackAttached();
		}

		//Add attach/detach/stopped events
		incomingStreamTrack
			.on("attached", this.onTrackAttached)
			.on("detached", this.onTrackDetached)
		    .once("stopped", this.onTrackStopped);

		//Add it to map
		this.tracks.set(incomingStreamTrack.getId(),incomingStreamTrack);

		!this.stopped && this.emit("track",this,incomingStreamTrack);
	}
	
	/**
	 * Remove a track from stream. Note the removed track is not stopped by calling this
	 * function. It's the caller's responsibility to stop it if the track is not used by
	 * any stream any more.
	 * 
	 * @param {string} trackId - Id of the track to be removed
	 * @returns {IncomingStreamTrack | undefined} - Removed track if found
	 */
	removeTrack(trackId: string): IncomingStreamTrack | undefined
	{
		//Get incoming track by id
		let incomingStreamTrack = this.tracks.get(trackId);
		//If track found
		if (incomingStreamTrack)
		{
			//Remove events
			incomingStreamTrack
				.off("attached", this.onTrackAttached)
				.off("detached", this.onTrackDetached)
				.off("stopped" , this.onTrackStopped);
			
			//Remove track from map
			this.tracks.delete(trackId);

			//Fire event
			this.emit("trackremoved", this, incomingStreamTrack);
			
			//If track was attached
			if (incomingStreamTrack.isAttached())
			{
				//Detach it manually
				this.onTrackDetached();
			}
		}
		//Return the removed track
		return incomingStreamTrack;
	}

	/**
	 * Create new track from a TrackInfo object and add it to this stream
	 * @param media Media type
	 * @param params Track info
	 * @returns {IncomingStreamTrack}
	 */
	createTrack(media: TrackType, params?: TrackInfoLike): IncomingStreamTrack
	{
		//Delegate to transport
		if(this.transport === null)
			throw new Error("Transport is null");
		else return this.transport.createIncomingStreamTrack(media, params, this);
	}

	/**
	 * Reset ssrc state of all tracks
	 */
	reset(): void
	{
		for (const track of this.tracks.values()) {
			track.reset();
		}
	}


	/**
	 * Return if the stream is attached or not
	 */
	isAttached(): boolean {
        for (const track of this.tracks.values()) {
            if (track.isAttached()) {
                return true;
			}
		}
        return false;
    }

	/**
	 * Removes the media strem from the transport and also detaches from any attached incoming stream
	 */
	stop(): void
	{
		//Don't call it twice
		if (this.stopped) return;

		//Stopped
		this.stopped = true;
		
		//Stop all streams
		for (let track of this.tracks.values()) {
			track.stop();
		}

		//Get last stats for all tracks
		const stats = this.getStats();
		
		//Clear tracks jic
		this.tracks.clear();
		
		this.emit("stopped",this,stats);
		
		//Stop emitter
		super.stop();
		
		//Remove transport reference, so destructor is called on GC
		this.transport = null;
	}
}
