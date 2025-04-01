import * as Native from "./Native";
import Emitter from "medooze-event-emitter";
import {Refresher} from "./Refresher";
import * as SharedPointer from "./SharedPointer";
import {IncomingStreamTrack} from "./IncomingStreamTrack";

export type FrameType = "Audio" | "Video" | "Text" | "Unknown";

export interface Frame {
    type: FrameType;
    codec: string;
    buffer: Uint8Array;
}

interface IncomingStreamTrackReaderEvents {
    stopped: (self: IncomingStreamTrackReader) => void;
    frame: (frame: Frame, self: IncomingStreamTrackReader) => void;
}

export class IncomingStreamTrackReader extends Emitter<IncomingStreamTrackReaderEvents>
{
	intraOnly: boolean;
    minPeriod: number;
    reader: SharedPointer.Proxy<Native.MediaFrameReaderShared>;
    refresher?: Refresher;
    attached: IncomingStreamTrack | null = null;
    stopped: boolean = false;

	// native callback
	private onframe: (buffer: Uint8Array,type: FrameType,codec: string,) => void;

	constructor(
		intraOnly: boolean,
		minPeriod: number,
		ondemand: boolean)
	{
		//Init emitter
		super();
		//Store properties
		this.intraOnly = intraOnly;
		this.minPeriod = minPeriod;
		//Create decoder
		this.reader = SharedPointer.SharedPointer(new Native.MediaFrameReaderShared(this,intraOnly,minPeriod,!!ondemand));

		//Check if we need to create a refresher for requesting intra periodically
		if (this.minPeriod>0)
			//Create one
			this.refresher = new Refresher(this.minPeriod);

		//If we only want intra frames done exactly after refresh
		if (intraOnly && ondemand)
			//Just before
			this.refresher?.on("refreshing",()=>{
				//Signal reader to grab next one
				this.reader.GrabNextFrame();
			});

		// bind `this` since this method will be called from event handler
		this.onTrackStopped = this.onTrackStopped.bind(this);

		// Native callback Frame listener
		this.onframe = (
			buffer: Uint8Array,
			type: FrameType,
			codec: string,
		) => {
			this.emit("frame", {buffer,type,codec}, this);
			//Reset refresher interval
			this.refresher?.restart(this.minPeriod);
		}
	}

	/** Track listener */
	private onTrackStopped() {
		//Dettach
		this.detach();
	}

	grabNextFrame(): void
	{
		//Signal reader to grab next one
		this.reader.GrabNextFrame();
	}

	detach(): void
	{
		//If attached to a decoder
		if (this.attached)
		{
			//Stop periodic refresh
			this.refresher?.remove(this.attached);
			//remove frame listener
			this.attached.depacketizer.RemoveMediaListener(this.reader.toMediaFrameListener());
			//remove listener
			this.attached.off("stopped",this.onTrackStopped);
			
		}
		//Not attached
		this.attached = null;
	}
	
	attachTo(track?: IncomingStreamTrack): void
	{
		//Detach first
		this.detach();
		
		//Check if valid object
		if (track)
		{
			//Signal reader to grab next one
			this.reader.GrabNextFrame();
			//Add frame listener
			track.depacketizer.AddMediaListener(this.reader.toMediaFrameListener());
			//Listen for events
			track.once("stopped",this.onTrackStopped);
			//Keep attached object
			this.attached = track;
			//Do periodic refresh
			this.refresher?.add(track);
		}
	}

	stop()
	{
		//Don't call it twice
		if (this.stopped) return;
		
		//Stop
		this.stopped = true;

		//Detach first
		this.detach();
		
		//Stop refresher
		this.refresher?.stop();

		this.emit("stopped", this);
		
		//Stop emitter
		super.stop();
		
		//Remove native refs
		//@ts-expect-error
		this.reader = null;
	}
}
