import {IncomingStream} from "./IncomingStream";
import {IncomingStreamTrack} from "./IncomingStreamTrack";
import Emitter from "medooze-event-emitter";

interface RefresherEvents {
    stopped: (self: Refresher) => void;
	/** A refreh is taking place */
    refreshing: (self: Refresher) => void;
}

/**
 * Periodically request an I frame on all incoming stream or tracks
 */
export class Refresher extends Emitter<RefresherEvents>
{
	tracks: Set<IncomingStreamTrack>;
    interval: NodeJS.Timeout | undefined;

	constructor(period: number)
	{
		//Init emitter
		super();

		//No tracks
		this.tracks = new Set<IncomingStreamTrack>();
		
		// bind `this` since this will be called from event handler
		this.onTrackStopped = this.onTrackStopped.bind(this)

		//Start refreshing
		this.restart(period);
	}

	/** Listener for stop track events */
	private onTrackStopped(track: IncomingStreamTrack) {
		//Remove from set
		this.tracks.delete(track);
	}

	/**
	 * Restart refreshing interval
	 * @param {Number} period - Refresh period in ms
	 */
	restart(period: number): void
	{
		//Stop previous one
		clearInterval(this.interval);
		//Start the refresh interval
		this.interval = setInterval(() => {
			//Emit event
			this.emit("refreshing",this);
			//For each track on set
			for (const track of this.tracks) {
				//request an iframe
				track.refresh();
			}
		}, period);
	}

	/**
	 * Add stream or track to request 
	 * @param {IncomingStream|IncomingStreamTrack} streamOrTrack 
	 */
	add(streamOrTrack: IncomingStream|IncomingStreamTrack): void
	{
		if (streamOrTrack instanceof IncomingStream)
		{
			//Get all video tracks
			for (const track of streamOrTrack.getVideoTracks()) {
				//Add it
				this.add(track);
			}
		} else if (streamOrTrack instanceof IncomingStreamTrack) {
			//Ensure it is a video one
			if (streamOrTrack.getMedia()==="video")
			{
				//Add to set
				this.tracks.add(streamOrTrack);
				//Remove it on stop
				streamOrTrack.once("stopped",this.onTrackStopped);
			}
		}
	}

	/**
	 * Remove stream or track to request 
	 * @param {IncomingStream|IncomingStreamTrack} streamOrTrack 
	 */
	remove(streamOrTrack: IncomingStream|IncomingStreamTrack): void
	{
		if (streamOrTrack instanceof IncomingStream)
		{
			for (const track of streamOrTrack.getVideoTracks()) {
				this.remove(track);
			}
		} else if (streamOrTrack instanceof IncomingStreamTrack) {
			if (streamOrTrack.getMedia()==="video")
			{
				this.tracks.delete(streamOrTrack);
				streamOrTrack.off("stopped",this.onTrackStopped);
			}
		}
	}
	
	/**
	 * Stop refresher
	 */
	stop(): void
	{
		//Stop interval
		clearInterval(this.interval);
		
		//For each track on set
		for (const track of this.tracks) {
			//Remove stop edevent
			track.off("stopped",this.onTrackStopped);
		}
		this.emit("stopped",this);
		
		//Stop emitter
		super.stop();
			
		//Clean set
		//@ts-expect-error
		this.tracks = null;
	}
}
