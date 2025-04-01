import {IncomingStreamTrack} from "./IncomingStreamTrack";
import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";

interface ActiveSpeakerDetectorEvents {
	/** New active speaker detected event (`track` is the track that has been activated) */
    activespeakerchanged: (track: IncomingStreamTrack) => void;
    stopped: () => void;
}

/**
 * ActiveSpeakerDetector accumulate received voice activity and fires an event when it changes
 */
export class ActiveSpeakerDetector extends Emitter<ActiveSpeakerDetectorEvents>
{
	detector: Native.ActiveSpeakerDetectorFacade;
    maxId: number;
    ids: WeakMap<IncomingStreamTrack, number>;
	tracks: Map<number, IncomingStreamTrack>;

	// native callback
	private onactivespeakerchanged: (id: number) => void;

	constructor()
	{
		//Init emitter
		super();
		
		//List of the tracks associated to the speakers
		this.maxId  = 1;
		this.ids    = new WeakMap();
		this.tracks = new Map();
		
		//Listen for speaker changes		
		this.onactivespeakerchanged = (id: number) => {
			//Get track
			const track = this.tracks.get(id);
			//Prevent race condition
			if (track)
				//Emit event
				this.emit("activespeakerchanged",track);
		};
		
		//Create native detector
		this.detector = new Native.ActiveSpeakerDetectorFacade(this);
		
		this.onTrackStopped = this.onTrackStopped.bind(this)
	}

	/** The listener for attached tracks end event */
	private onTrackStopped(track: IncomingStreamTrack) {
		//Remove track
		this.removeSpeaker(track);
	}
	
	/**
	 * Set minimum period between active speaker changes
	 * @param {Number} minChangePeriod
	 */
	setMinChangePeriod(minChangePeriod: number)
	{
		this.detector.SetMinChangePeriod(minChangePeriod);
	}
	
	/**
	 * Maximux activity score accumulated by an speaker
	 * @param {Number} maxAcummulatedScore
	 */
	setMaxAccumulatedScore(maxAcummulatedScore: number)
	{
		this.detector.SetMaxAccumulatedScore(maxAcummulatedScore);
	}
	
	/**
	 * Minimum db level to not be considered as muted
	 * @param {Number} noiseGatingThreshold
	 */
	setNoiseGatingThreshold(noiseGatingThreshold: number)
	{
		this.detector.SetNoiseGatingThreshold(noiseGatingThreshold);
	}
	
	/**
	 * Set minimum activation score to be electible as active speaker
	 * @param {Number} minActivationScore
	 */
	setMinActivationScore(minActivationScore: number)
	{
		this.detector.SetMinActivationScore(minActivationScore);
	}
	
	/**
	 * Add incoming track for speaker detection
	 * @param {IncomingStreamTrack} track
	 */
	addSpeaker(track: IncomingStreamTrack) 
	{
		//Ensure that we don't have this trak already
		if (this.ids.has(track))
			//Error
			throw new Error("Track already added");
		//Get first source
		const source = track.getDefaultEncoding().source;
		//Check source
		if (!source)
			//Error
			throw new Error("Could not find source for track");
		
		//Generate a new id
		const id = this.maxId++;
		//Store on maps
		this.ids.set(track,id);
		this.tracks.set(id,track);
		//Start listening to it
		this.detector.AddIncomingSourceGroup(SharedPointer.getPointer(source), id);
		//Singal track is attached
		track.attached();
		
		//Listen for stop events
		track.once("stopped", this.onTrackStopped);

	}
	
	/**
	 * Remove track from speaker detection
	 * @param {IncomingStreamTrack} track
	 */
	removeSpeaker(track: IncomingStreamTrack) 
	{
		//Get id
		const id = this.ids.get(track);
		
		//Ensure we have it
		if (!id)
			throw new Error("Could not find track");
		
		//Delete id
		this.ids.delete(track);
		
		//Get first source
		const source = track.getDefaultEncoding().source;
		//Check source
		if (!source)
			//Error
			throw new Error("Could not find sourc for track");
		
		//Stop listening to it
		this.detector.RemoveIncomingSourceGroup(SharedPointer.getPointer(source));

		//Singal track is detached
		track.detached();
		
		//Delete track
		this.tracks.delete(id);
		
		//Stopp listening events
		track.off("stopped", this.onTrackStopped);
	}
	
	
	/**
	 * Stop this transponder, will dettach the OutgoingStreamTrack
	 */
	stop(): void
	{
		//Stop listening for events, as they might have been queued
		this.onactivespeakerchanged = ()=>{};
		//Stop listening on any track
		for (const track of this.tracks.values()) {
			//remove track
			this.removeSpeaker (track);
		}
		this.emit("stopped");

		//Stop emitter
		super.stop();
		
		//Remove native reference, so destructor is called on GC
		//@ts-expect-error
		this.detector = null;
	}
	
};
