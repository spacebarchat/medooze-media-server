import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";
import { 
    SDPInfo, 
    Setup, 
    MediaInfo, 
    CandidateInfo, 
    DTLSInfo, 
    ICEInfo, 
    StreamInfo, 
    TrackInfo, 
    SourceGroupInfo,
    TrackType 
} from "semantic-sdp";

import { LayerSelection, Transponder } from "./Transponder";
import { IncomingStreamTrack } from "./IncomingStreamTrack";
import {SSRCs, Transport} from "./Transport";

/** Stats for media, rtx, and fec sources (if used) */
export interface OutgoingTrackStats {
	/** Timestamp on when this stats were created */
    timestamp: number;
	/** Stats for the media stream */
    media: OutgoingMediaStats;
	/** Stats for the FEC stream */
    fec: OutgoingMediaStats;
	/** Stats for the RTX stream */
    rtx: OutgoingMediaStats;
	/** Remote estimated bitrate (if remb is in use) */
    remb?: number;
	/** Total sent frames */
    numFrames: number;
	/** Sent frames during last second */
    numFramesDelta: number;
	/** Number of rtp packets sent */
    numPackets: number;
	/** Number of rtp packets sent during last second */
    numPacketsDelta: number;
	/** Round Trip Time in ms */
    rtt: number;
	/** Bitrate for media stream only in bps */
    bitrate: number;
	/** Accumulated bitrate for media, rtx and fec streams in bps (deprecated)
	 * @deprecated
	 */
    total?: number;
	/** Accumulated bitrate for media, rtx and fec streams in bps */
    totalBitrate: number;
	/** Total rtp sent bytes for this layer */
    totalBytes: number;
}

/** Stats for each RTP source */
export interface OutgoingMediaStats {
	/** Round Trip Time in ms */
    rtt: number;
	/** Total sent frames */
    numFrames: number;
	/** Sent frames during last second */
    numFramesDelta: number;
	/** Number of rtp packets sent */
    numPackets: number;
	/** Number of rtp packets sent during last second */
    numPacketsDelta: number;
	/** Number of rtcp packets sent */
    numRTCPPackets: number;
	/** Total rtp sent bytes */
    totalBytes: number;
	/** Total rtp sent bytes */
    totalRTCPBytes: number;
	/** Average bitrate sent during last second in bps */
    bitrate: number;
	/** Accumulated bitrate for media and rtx streams in bps */
    totalBitrate: number;
	/** Number of RTCP receiver reports received */
    reportCount: number;
	/** Number of RTCP receiver reports received during last second */
    reportCountDelta: number;
	/** Last report, if available */
    reported?: ReceiverReport;
}

/** RTP receiver report stats */
export interface ReceiverReport {
	/** Total packet loses reported */
    lostCount: number;
	/** Packet losses reported in last second */
    lostCountDelta: number;
	/** Fraction loss media reported during last second */
    fractionLost: number;
	/** Last reported jitter buffer value */
    jitter: number;
}

function getSourceStats(source: Native.RTPOutgoingSourceGroup): OutgoingTrackStats
{
	const mediaStats = getStatsFromOutgoingSource(source.media);
	const rtxStats = getStatsFromOutgoingSource(source.rtx);
	const fecStats = getStatsFromOutgoingSource(source.fec);

	return {
		media		: mediaStats,
		fec			: fecStats,
		rtx			: rtxStats,
		remb		: source.media.remb,
		timestamp	: Date.now(),
		rtt		: Math.max(mediaStats.rtt, fecStats.rtt, rtxStats.rtt),
		bitrate		: mediaStats.bitrate,
		total		: mediaStats.totalBitrate + fecStats.totalBitrate + rtxStats.totalBitrate, // DEPRECATED
		totalBitrate	: mediaStats.totalBitrate + fecStats.totalBitrate + rtxStats.totalBitrate,
		totalBytes	: mediaStats.totalBytes + rtxStats.totalBytes,
		numFrames	: mediaStats.numFrames,
		numFramesDelta	: mediaStats.numFramesDelta,
		numPackets	: mediaStats.numPackets + fecStats.numPackets + rtxStats.numPackets,
		numPacketsDelta	: mediaStats.numPacketsDelta + fecStats.numPacketsDelta + rtxStats.numPacketsDelta,
	};
}

function getStatsFromOutgoingSource(source: Native.RTPOutgoingSource): OutgoingMediaStats
{
	return {
		rtt			: source.rtt,
		numFrames		: source.numFrames,
		numFramesDelta		: source.numFramesDelta,
		numPackets		: source.numPackets,
		numPacketsDelta		: source.numPacketsDelta,
		numRTCPPackets		: source.numRTCPPackets,
		totalBytes		: source.totalBytes,
		totalRTCPBytes		: source.totalRTCPBytes,
		bitrate			: source.bitrate,		// Acumulator window is 1000ms so Instant==InstantAvg
		totalBitrate		: source.totalBitrate,
		reportCount		: source.reportCount,
		reportCountDelta	: source.reportCountDelta,
		reported		: source.reportCountDelta ? {
			lostCount	: source.reportedLostCount,
			lostCountDelta	: source.reportedLostCountDelta,
			fractionLost	: source.reportedFractionLost,
			jitter		: source.reportedJitter,
		} : undefined,
	};
}

/** Outgoing Stream Track Events */
export interface OutgoingStreamTrackEvents {
    stopped: (self: OutgoingStreamTrack, stats: OutgoingTrackStats) => void;
    muted: (muted: boolean) => void;
    remb: (bitrate: number, self: OutgoingStreamTrack) => void;
}

/**
 * Audio or Video track of a media stream sent to a remote peer
 */
export class OutgoingStreamTrack extends Emitter<OutgoingStreamTrackEvents>
{
	readonly id: string;
    readonly mediaId: string;
    readonly media: TrackType;
    sender: SharedPointer.Proxy<Native.RTPSenderShared>;
    source: SharedPointer.Proxy<Native.RTPOutgoingSourceGroupShared>;
    
    muted: boolean = false;
    transponder: Transponder | null = null;
    stats: OutgoingTrackStats;
    stopped: boolean = false;
    trackInfo: TrackInfo;

	// native callback
	private onremb: (bitrate: number) => void;

	constructor(
		media: TrackType, 
        id: string, 
        mediaId: string, 
        sender: SharedPointer.Proxy<Native.RTPSenderShared>, 
        source: SharedPointer.Proxy<Native.RTPOutgoingSourceGroupShared>
	) {
		super();

		this.id = id;
        this.mediaId = mediaId;
        this.media = media;
        this.sender = sender;
        this.source = source;

        this.trackInfo = new TrackInfo(media, id);

		if (this.mediaId) {
			this.trackInfo.setMediaId(this.mediaId);
		}

		//Add ssrcs to track
		this.trackInfo.addSSRC(source.media.ssrc);
		source.rtx?.ssrc && this.trackInfo.addSSRC(source.rtx.ssrc);
		source.fec?.ssrc && this.trackInfo.addSSRC(source.fec.ssrc);
		
		//Add RTX and FEC group	
		source.rtx?.ssrc && this.trackInfo.addSourceGroup(new SourceGroupInfo("FID",[source.media.ssrc,source.rtx.ssrc]));
		source.fec?.ssrc && this.trackInfo.addSourceGroup(new SourceGroupInfo("FEC-FR",[source.media.ssrc,source.fec.ssrc]));

		//Init stats
		this.stats = getSourceStats(this.source);

		//Native REMB event
		this.onremb = (bitrate: number) => {
            this.emit("remb", bitrate, this);
        };
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
	* Get track media type
	*/
	getMedia(): TrackType
	{
		return this.media;
	}
	
	/**
	 * Get track info object
	 * @returns {TrackInfo} Track info
	 */
	getTrackInfo(): TrackInfo
	{
		return this.trackInfo;
	}
	
	/**
	 * Get stats for all encodings 
	 * @returns {OutgoingTrackStats}
	 */
	getStats(): OutgoingTrackStats
	{
		//Get current timestamp
		const ts = Date.now();

		//Check if we have old cached stats
		if (this.source && (ts - this.stats.timestamp)>100 )
		{
			//If it was updated to long ago
			if ((ts - this.source.lastUpdated)>100)
				//Update the source
				this.source.Update();
		
			//Cache stats
			this.stats = getSourceStats(this.source);

		}
		//Return the cached stats
		return this.stats;
	}

	/**
	 * Get stats for all encodings 
	 * @returns {Promise<OutgoingTrackStats>}
	 */
	async getStatsAsync(): Promise<OutgoingTrackStats>
	{
		//Get current timestamp
		const ts = Date.now();

		//Check if we have old cached stats
		if (this.source && (ts - this.stats.timestamp)>100)
		{
			//If it was updated to long ago
			if ((ts - this.source.lastUpdated)>100)
				//Update the source
				await new Promise(resolve=>this.source.UpdateAsync({resolve}));
		
			//If not stopped while waiting
			if (this.source)
				//Cache stats
				this.stats = getSourceStats(this.source);
		}
		//Return the cached stats
		return this.stats;
	}

	/**
	 * Return ssrcs associated to this track
	 */
	getSSRCs(): SSRCs
	{
		//Return the sssrcs map
		return {
			media : this.source.media.ssrc,
			fec	  : this.source.fec.ssrc,
			rtx   : this.source.rtx.ssrc
		};
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
		//Mute transpoder always
		this.transponder && this.transponder.mute(muting);
		
		//If we are different
		if (this.muted!==muting)
		{
			//Store it
			this.muted = muting;
			this.emit("muted",this.muted);
		}
	}
	
	/**
	 * Check if this outgoing stream track is alredy attached to an incoming stream track.
	 * @returns {Boolean} true if attached, false otherwise
	 */
	isAttached(): boolean
	{
		return !!this.transponder?.getIncomingTrack();
	}

	/**
	 * Create a transponder if not already attached or return current one.
	 * @returns {Transponder} Track transponder object
	 */
	createTransponder(): Transponder
	{
		//If we don't have transponder yet
		if (!this.transponder)
		{
			//If already stopped
			if (this.stopped)
				//Throw error, can cause seg fault on native code otherwise
				throw new Error("Cannot create transponder, OutgoingStreamTrack is already stopped");

			//Create native transponder object
			const transponder = SharedPointer.SharedPointer(new Native.RTPStreamTransponderFacadeShared(this.source,this.sender,this));

			//Store transponder wrapper
			this.transponder = new Transponder(transponder, this.media);

			//If we are muted
			if (this.muted)
				//Mute transponder also
				this.transponder.mute(this.muted);

			//Listen the stop event
			this.transponder.once("stopped",()=>{
				//Dettach
				this.transponder = null;
			});
		}

		return this.transponder;
	}

	forcePlayoutDelay(minDelay: number, maxDelay: number): void
	{
		this.source.SetForcedPlayoutDelay(minDelay, maxDelay);
	}

	
	/**
	 * Listen media from the incoming stream track and send it to the remote peer of the associated transport.
	 * This will stop any previous transponder created by a previous attach.
	 * @param {IncomingStreamTrack} incomingStreamTrack - The incoming stream to listen media for
	 * @param {LayerSelection} [layers]			- Layer selection info
	 * @param {Boolean} [smooth]					- Wait until next valid frame before switching to the new encoding
	 * @returns {Transponder} Track transponder object
	 */
	attachTo(
        incomingStreamTrack: IncomingStreamTrack, 
        layers?: LayerSelection, 
        smooth?: boolean
    ): Transponder
	{
		//If we don't have transponder yet
		if (!this.transponder)
			//Create it
			this.transponder = this.createTransponder();
		
		//Set track
		this.transponder.setIncomingTrack(incomingStreamTrack, layers, smooth);
		
		//Return transponder
		return this.transponder;
	}
	
	/**
	 * Stop forwarding any previous attached track.
	 * This will set the transponder inconming track to null
	 */
	detach(): void
	{
		//If not attached
		if (!this.transponder)
			//Do nothing
			return;
		
		//Remove null track
		this.transponder.setIncomingTrack(null);
	}
	
	/**
	 * Get attached transponder for this track
	 * @returns {Transponder | null} Attached transponder or null if not attached
	 */
	getTransponder(): Transponder | null 
	{
		return this.transponder;
	}

	/**
	 * Removes the track from the outgoing stream and also detaches from any attached incoming track
	 */
	stop(): void
	{
		//Don't call it twice
		if (this.stopped) return;

		//Stopped
		this.stopped = true;
		
		//If we had a transponder
		if (this.transponder)
			//Stop transponder
			this.transponder.stop();

		//Update stats
		this.stats = getSourceStats(this.source);

		//Stop source source
		this.source.Stop();
		
		//Stop listening for events, as they might have been queued
		this.onremb = ()=>{};
		
		this.emit("stopped",this, this.stats);
		
		//Stop emitter
		super.stop();
		
		//Remove transport reference, so destructor is called on GC
		
		(this.source as any) = null;
        (this.sender as any) = null;
	}
}
