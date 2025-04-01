import * as Native from './Native';
import Emitter from 'medooze-event-emitter';
import * as SharedPointer from './SharedPointer';
import {IncomingStreamTrack} from './IncomingStreamTrack';

interface RecorderTrackEvents {
    stopped: (self: RecorderTrack) => void;
    muted: (muted: boolean) => void;
}

/**
 * Track of the recorder associated to an incoming strem track
 */
export class RecorderTrack extends Emitter<RecorderTrackEvents>
{
	id: number;
    track: IncomingStreamTrack;
    depacketizer: SharedPointer.Proxy<Native.RTPIncomingMediaStreamDepacketizerShared>;
    recorder: Native.MP4RecorderFacadeShared;
    muted: boolean;

	constructor(
		id: number,
		track: IncomingStreamTrack,
		depacketizer: SharedPointer.Proxy<Native.RTPIncomingMediaStreamDepacketizerShared>,
		recorder: Native.MP4RecorderFacadeShared)
	{
		//Init emitter
		super();

		//Store track info
		this.id			= id;
		this.track		= track;
		this.depacketizer	= depacketizer;
		this.recorder		= recorder;
		//Not muted
		this.muted = false;
		
		//Start listening for frames
		this.depacketizer.AddMediaListener(this.recorder.toMediaFrameListener());

		// bind `this` since this will be called from event handler
		this.onTrackStopped = this.onTrackStopped.bind(this);
		
		//Listen for track stop event
		this.track.once("stopped", this.onTrackStopped);
	}

	/** Listener for stop track events */
	private onTrackStopped(): void {
		//stop recording
		this.stop();
	};
	
	/**
	* Get recorder track id
	*/
	getId(): number
	{
		return this.id;
	}
	
	/**
	* Get incoming stream track 
	* @returns {IncomingStreamTrack} 
	*/
	getTrack(): IncomingStreamTrack
	{
		return this.track;
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
	 * This operation will not change the muted state of the stream this track belongs too.
	 * @param {boolean} muting - if we want to mute or unmute
	 */
	mute(muting: boolean): void
	{
		//If we are different
		if (this.muted!==muting)
		{
			//Check what are we doing
			if (muting) {
				//Stop listening for frames
				this.depacketizer.RemoveMediaListener(this.recorder);
			}else {
				//Start listening for frames
				this.depacketizer.AddMediaListener(this.recorder);
				//Request a refresh on the track
				this.track.refresh();
			}
				
			//Store it
			this.muted = muting;
			
			this.emit("muted",this.muted);
		}
	}
	
	/**
	 * Stop recording this track
	 */
	stop(): void
	{
		//Don't call it twice
		if (!this.track) return;
		
		//Stop listening for frames
		this.depacketizer.RemoveMediaListener(this.recorder.toMediaFrameListener());
		
		//Remove listener
		this.track.off("stopped",this.onTrackStopped);
		
		this.emit("stopped",this);
		
		//Stop emitter
		super.stop();
		
		//Remove track
		//@ts-expect-error
		this.track = null;
		//@ts-expect-error
		this.depacketizer = null;
		//@ts-expect-error
		this.recorder = null;
	}
}
