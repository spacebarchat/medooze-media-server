import * as Native from "./Native";
import * as SharedPointer from "./SharedPointer";
import Emitter from "medooze-event-emitter";
import * as LayerInfo from "./LayerInfo";
import { 
    TrackType, 
    TrackInfo, 
    TrackEncodingInfo, 
    SourceGroupInfo 
} from "semantic-sdp";
import { SSRCs } from "./Transport";

/** Information about each spatial/temporal layer (if present) */
export interface LayerStats {
    active?: boolean;
    simulcastIdx: number;
    spatialLayerId: number;
    temporalLayerId: number;
	/** total rtp received bytes for this layer */
    totalBytes: number;
	/** number of rtp packets received for this layer */
    numPackets: number;
	/** average media bitrate received during last second for this layer */
    bitrate: number;
	/** average total bitrate received during last second for this layer */
    totalBitrate: number;
	/** video width */
    width?: number;
	/** video height */
    height?: number;
	/** signaled target bitrate on the VideoLayersAllocation header */
    targetBitrate?: number;
	/** signaled target width on the VideoLayersAllocation header */
    targetWidth?: number;
	/** signaled target height on the VideoLayersAllocation header */
    targetHeight?: number;
	/** signaled target fps on the VideoLayersAllocation header */
    targetFps?: number;
	/** Name of the codec last in use */
    codec: string;
}

/** Stats for each media stream */
export interface IncomingMediaStats {
	/** total lost packets */
    lostPackets: number;
	/** total lost/out of order packets during last second */
    lostPacketsDelta: number;
	/** max total consecutive packets lost during last second */
    lostPacketsMaxGap?: number;
	/** number of packet loss bursts during last second */
    lostPacketsGapCount?: number;
	/** droppted packets by media server */
    dropPackets?: number;
	/** number of frames received */
    numFrames: number;
	/** number of frames received during last second */
    numFramesDelta: number;
	/** number of rtp packets received */
    numPackets: number;
	/** number of rtp packets received during last second */
    numPacketsDelta: number;
	/** number of rtcp packsets received */
    numRTCPPackets?: number;
	/** total rtp received bytes */
    totalBytes: number;
	/** total rtp received bytes */
    totalRTCPBytes?: number;
	/** total PLIs sent */
    totalPLIs?: number;
	/** total NACk packets sent */
    totalNACKs?: number;
	/** average media bitrate received during last second for this layer */
    bitrate: number;
	/** average total bitrate received during last second for this layer */
    totalBitrate: number;
	/** difference between NTP timestamp and RTP timestamps at sender (from RTCP SR) */
    skew?: number;
	/** ratio between RTP timestamps and the NTP timestamp and  at sender (from RTCP SR) */
    drift?: number;
	/** RTP clockrate */
    clockrate?: number;
	/** Average frame delay during the last second */
    frameDelay?: number;
	/** Max frame delay during the last second */
    frameDelayMax?: number;
	/** Average bewtween local reception time and sender capture one (Absolute capture time must be negotiated) */
    frameCaptureDelay?: number;
	/** Max bewtween local reception time and sender capture one (Absolute capture time must be negotiated) */
    frameCaptureDelayMax?: number;
	/** video width */
    width?: number;
	/** video height */
    height?: number;
	/** signaled target bitrate on the VideoLayersAllocation header */
    targetBitrate?: number;
	/** signaled target width on the VideoLayersAllocation header */
    targetWidth?: number;
	/** signaled target height on the VideoLayersAllocation header */
    targetHeight?: number;
	/** signaled target fps on the VideoLayersAllocation header */
    targetFps?: number;
	/** Information about each spatial/temporal layer (if present). */
    layers: LayerStats[];
	/** Information about each individual layer */
    individual?: LayerStats[];
}

/** Packet waiting times in RTP buffer before delivering them */
export interface PacketWaitTime {
    min: number;
    max: number;
    avg: number;
}

/** Stats for each encoding (media and rtx sources) */
export interface EncodingStats {
	/** When this stats was generated (in order to save workload, stats are cached for 200ms) */
    timestamp: number;
	/** Packet waiting times in RTP buffer before delivering them */
    waitTime: PacketWaitTime;
	/** Stats for the media stream */
    media: IncomingMediaStats;
	/** Stats for the rtx retransmission stream */
    rtx: IncomingMediaStats;
	/** Round Trip Time in ms */
    rtt: number;
	/** Bitrate for media stream only in bps */
    bitrate: number;
	/** Accumulated bitrate for media and rtx streams in bps
	 * @deprecated
	*/
    total: number;
	/** average total bitrate received during last second for this layer */
    totalBitrate: number;
	/** total rtp received bytes for this layer */
    totalBytes: number;
    lostPackets: number;
    lostPacketsDelta: number;
    numFrames: number;
    numFramesDelta: number;
    numPackets: number;
    numPacketsDelta: number;
	/** Estimated available bitrate for receiving (only available if not using transport wide cc) */
    remb: number;
	/** Simulcast layer index based on bitrate received (-1 if it is inactive). */
    simulcastIdx: number;
	/** Lost packets ratio */
    lostPacketsRatio?: number;
	/** video width */
    width?: number;
	/** video height */
    height?: number;
	/** signaled target bitrate on the VideoLayersAllocation header */
    targetBitrate?: number;
	/** signaled target width on the VideoLayersAllocation header */
    targetWidth?: number;
	/** signaled target height on the VideoLayersAllocation header */
    targetHeight?: number;
	/** signaled target fps on the VideoLayersAllocation header */
    targetFps?: number;
	/** Name of the codec last in use */
    codec: string;
}

/** Track stats providing info for each source */
export type IncomingTrackStats = { [encodingId: string]: EncodingStats };

export interface Encoding {
    id: string;
    source: SharedPointer.Proxy<Native.RTPIncomingSourceGroupShared>;
    receiver: SharedPointer.Proxy<Native.RTPReceiverShared>;
    depacketizer: SharedPointer.Proxy<Native.RTPIncomingMediaStreamDepacketizerShared>;
}

export interface ActiveEncodingInfo {
    id: string;
    simulcastIdx: number;
    bitrate: number;
	/** average bitrate (media + overhead) received during last second in bps */
    totalBitrate: number;
	/** total rtp received bytes for this layer */
    totalBytes: number;
	/** number of rtp packets received for this layer */
    numPackets: number;
    layers: LayerStats[];
    width?: number;
    height?: number;
	/** signaled target bitrate on the VideoLayersAllocation header */
    targetBitrate?: number;
	/** signaled target width on the VideoLayersAllocation header */
    targetWidth?: number;
	/** signaled target height on the VideoLayersAllocation header */
    targetHeight?: number;
	/** signaled target fps on the VideoLayersAllocation header */
    targetFps?: number;
	/** Name of the codec last in use */
    codec: string;
}

/** Active layers object containing an array of active and inactive encodings and an array of all available layer info */
export interface ActiveLayersInfo {
    active: ActiveEncodingInfo[];
    layers: (LayerStats & { encodingId: string })[];
    inactive: { id: string }[];
}

function getEncodingStats(encoding: Encoding): EncodingStats
{
	//Get stats from sources
	const mediaStats = getStatsFromIncomingSource(encoding.source.media);
	const rtxStats = getStatsFromIncomingSource(encoding.source.rtx);

	const encodingStats: EncodingStats = {
		rtt	 : encoding.source.rtt,
		waitTime : {
			min     : encoding.source.minWaitedTime,
			max	: encoding.source.maxWaitedTime,
			avg	: encoding.source.avgWaitedTime,
		},
		media		: mediaStats,
		rtx		: rtxStats,
		bitrate		: mediaStats.bitrate,
		total		: mediaStats.totalBitrate + rtxStats.totalBitrate, // DEPRECATED
		totalBitrate	: mediaStats.totalBitrate + rtxStats.totalBitrate,
		totalBytes	: mediaStats.totalBytes + rtxStats.totalBytes,
		lostPackets	: mediaStats.lostPackets + rtxStats.lostPackets,
		lostPacketsDelta: mediaStats.lostPacketsDelta + rtxStats.lostPacketsDelta,
		numFrames	: mediaStats.numFrames,
		numFramesDelta	: mediaStats.numFramesDelta,
		numPackets	: mediaStats.numPackets + rtxStats.numPackets,
		numPacketsDelta	: mediaStats.numPacketsDelta + rtxStats.numPacketsDelta,
		remb		: encoding.source.remoteBitrateEstimation,
		// timestamps
		timestamp	: Date.now(),
		// provisional (set by updateStatsSimulcastIndex)
		simulcastIdx	: -1,
		codec		: encoding.source.codec,
	};

	//Calculate packet lost ration from total num packets
	encodingStats.lostPacketsRatio = encodingStats.numPackets? encodingStats.lostPackets / encodingStats.numPackets : 0;
	//If we have dimenstions
	if (mediaStats.width && mediaStats.height)
	{
		//set it on encoding
		encodingStats.width  = mediaStats.width;
		encodingStats.height = mediaStats.height;
	}
	//Add optional attributes
	if (mediaStats.targetBitrate)
		encodingStats.targetBitrate	= mediaStats.targetBitrate;
	if (mediaStats.targetWidth)
		encodingStats.targetWidth	= mediaStats.targetWidth;
	if (mediaStats.targetHeight)
		encodingStats.targetHeight	= mediaStats.targetHeight;
	if (mediaStats.targetFps)
		encodingStats.targetFps		= mediaStats.targetFps;

	//Done
	return encodingStats;
}

function getStatsFromIncomingSource(source: Native.RTPIncomingSource): IncomingMediaStats 
{
	const stats: IncomingMediaStats = {
		numFrames		: source.numFrames,
		numFramesDelta		: source.numFramesDelta,
		lostPackets		: source.lostPackets,
		lostPacketsDelta	: source.lostPacketsDelta,
		lostPacketsMaxGap	: source.lostPacketsMaxGap,
		lostPacketsGapCount	: source.lostPacketsGapCount,
		dropPackets		: source.dropPackets,
		numPackets		: source.numPackets,
		numPacketsDelta		: source.numPacketsDelta,
		numRTCPPackets		: source.numRTCPPackets,
		totalBytes		: source.totalBytes,
		totalRTCPBytes		: source.totalRTCPBytes,
		totalPLIs		: source.totalPLIs,
		totalNACKs		: source.totalNACKs,
		bitrate			: source.bitrate, // Acumulator window is 1000ms so Instant==InstantAvg
		totalBitrate		: source.totalBitrate, // Acumulator window is 1000ms so Instant==InstantAvg
		skew			: source.skew,
		drift			: source.drift,
		clockrate		: source.clockrate,
		frameDelay		: source.frameDelay,
		frameDelayMax		: source.frameDelayMax,
		frameCaptureDelay	: source.frameCaptureDelay,
		frameCaptureDelayMax	: source.frameCaptureDelayMax,
		layers			: [],
	};

	//Check if we have width and height
	if (source.width && source.height)
	{
		stats.width = source.width;
		stats.height = source.height;
	}

	//Add optional attributes
	if (source.targetBitrate>0)
		stats.targetBitrate	=  source.targetBitrate;
	if (source.targetWidth>0)
		stats.targetWidth	=  source.targetWidth;
	if (source.targetHeight>0)
		stats.targetHeight	=  source.targetHeight;
	if (source.targetFps>0)
		stats.targetFps	= source.targetFps;
	
	//Get layers
	const layers = source.layers();

	//Not aggregated stats
	const individual: LayerStats[] = stats.individual = ([]);

	//Check if it has layer stats
	for (let i=0; i<layers.size(); ++i)
	{
		//Get layer
		const layer = layers.get(i);
		
		const curated: LayerStats = {
			spatialLayerId  : layer.spatialLayerId,
			temporalLayerId : layer.temporalLayerId,
			totalBytes	: layer.totalBytes,
			numPackets	: layer.numPackets,
			bitrate		: layer.bitrate,
			totalBitrate	: layer.totalBitrate,
			active		: layer.active, 
			// provisional (set by updateStatsSimulcastIndex)
			simulcastIdx	: -1,
			codec		: "unknown"
		}
		//Add optional attributes
		if (layer.targetBitrate>0)
			curated.targetBitrate	=  layer.targetBitrate;
		if (layer.targetWidth>0)
			curated.targetWidth	=  layer.targetWidth;
		if (layer.targetHeight>0)
			curated.targetHeight	=  layer.targetHeight;
		if (layer.targetFps>0)
			curated.targetFps	= layer.targetFps;
		//TODO: add width/height to svc layers in c++
		//@ts-expect-error (remove me once added in c++)
		if (layer.width>0) curated.width = layer.width;
		//@ts-expect-error (remove me once added in c++)
		if (layer.height>0) curated.height = layer.height;

		//Push layyer stats
		individual.push(curated);
	}

	//We need to aggregate layers
	for (const layer of individual)
	{
		//If the layers are not aggreagated
		if (!source.aggregatedLayers)
		{
			//Create empty stats
			const aggregated: LayerStats = {
				spatialLayerId	: layer.spatialLayerId,
				temporalLayerId	: layer.temporalLayerId,
				totalBytes	: 0,
				numPackets	: 0,
				bitrate		: 0,
				totalBitrate	: 0,
				// provisional (set by updateStatsSimulcastIndex)
				simulcastIdx	: -1,
				codec		: "unknown"
			};

			//Add optional attributes
			if (layer.hasOwnProperty("targetBitrate"))
				aggregated.targetBitrate	=  layer.targetBitrate;
			if (layer.hasOwnProperty("targetWidth"))
				aggregated.targetWidth		=  layer.targetWidth;
			if (layer.hasOwnProperty("targetHeight"))
				aggregated.targetHeight		=  layer.targetHeight;
			if (layer.hasOwnProperty("targetFps"))
				aggregated.targetFps		= layer.targetFps;
			if (layer.hasOwnProperty("width"))
				aggregated.width		= layer.width;
			if (layer.hasOwnProperty("height"))
				aggregated.height		= layer.height;

			//Search all individual
			for (const other of individual)
			{
				//If it is from a lower layer than this
				if (other.spatialLayerId <= aggregated.spatialLayerId && other.temporalLayerId <= aggregated.temporalLayerId)
				{
					//accumulate stats
					aggregated.totalBytes += other.totalBytes;
					aggregated.numPackets += other.numPackets;
					aggregated.bitrate += other.bitrate;
					aggregated.totalBitrate += other.totalBitrate;
				}
			}
			//Add it to layer stats
			stats.layers.push(aggregated);
		} else {
			//Use the individual stats
			//TODO: maybe calculate individual layers inside the media server?
			stats.layers.push(layer);
		}

	}

	//Return complete stats
	return stats;
}

function sortByBitrate(
    a: EncodingStats | LayerStats | ActiveEncodingInfo, 
    b: EncodingStats | LayerStats | ActiveEncodingInfo
): number
{
	return a.targetBitrate && b.targetBitrate 
		? a.targetBitrate - b.targetBitrate 
		: a.bitrate - b.bitrate;
}

function sortByBitrateReverse(
    a: EncodingStats | LayerStats | ActiveEncodingInfo, 
    b: EncodingStats | LayerStats | ActiveEncodingInfo
): number
{
	return a.targetBitrate && b.targetBitrate 
		? b.targetBitrate - a.targetBitrate 
		: b.bitrate - a.bitrate;
}

function updateStatsSimulcastIndexAndCodec(stats: IncomingTrackStats): void
{
	//Set simulcast index
	let simulcastIdx = 0;
		
	//Order the encodings in reverse order
	for (let stat of Object.values(stats).sort(sortByBitrate))
	{
		//Set simulcast index if the encoding is active
		stat.simulcastIdx = stat.bitrate ? simulcastIdx++ : -1;
		//For all layers
		for (const layer of stat.media.layers)
		{
			//Set it also there
			layer.simulcastIdx = stat.simulcastIdx;
			layer.codec = stat.codec;
		}
		for (const layer of stat.media.individual || [])
		{
			//Set it also there
			layer.simulcastIdx = stat.simulcastIdx;
			layer.codec = stat.codec;
		}
	}
}


function getActiveLayersFromStats(stats: IncomingTrackStats): ActiveLayersInfo
{
	const active: ActiveLayersInfo['active'] =  ([]);
	const inactive: ActiveLayersInfo['inactive']  =  ([]);
	const all: ActiveLayersInfo['layers'] =  ([]);

	//For all encodings
	for (const id in stats)
	{
		//If it is inactive
		if (!stats[id].bitrate)
		{
			//Add to inactive encodings
			inactive.push({
				id: id
			});
			//skip
			continue;
		}
			
		//Append to encodings
		const encoding: ActiveEncodingInfo = {
			id		: id,
			simulcastIdx	: stats[id].simulcastIdx,
			totalBytes	: stats[id].totalBytes,
			numPackets	: stats[id].numPackets,
			bitrate		: stats[id].bitrate,
			totalBitrate	: stats[id].totalBitrate,
			codec		: stats[id].codec,
			layers		: []
		};

		//Add optional attributes
		if (stats[id].media.targetBitrate)
			encoding.targetBitrate	=  stats[id].media.targetBitrate;
		if (stats[id].media.targetWidth)
			encoding.targetWidth	=  stats[id].media.targetWidth;
		if (stats[id].media.targetHeight)
			encoding.targetHeight	=  stats[id].media.targetHeight;
		if (stats[id].media.targetFps)
			encoding.targetFps	= stats[id].media.targetFps;

		//Check if we have width and height
		if (stats[id].media.width && stats[id].media.height)
		{
			//Set them
			encoding.width = stats[id].media.width;
			encoding.height = stats[id].media.height;
		}
			
		//Get layers
		const layers = stats[id].media.layers; 
			
		//For each layer
		for (const layer of layers)
		{

			const layerStats: LayerStats = {
				simulcastIdx	: layer.simulcastIdx,
				spatialLayerId	: layer.spatialLayerId,
				temporalLayerId	: layer.temporalLayerId,
				totalBytes	: layer.totalBytes,
				numPackets	: layer.numPackets,
				bitrate		: layer.bitrate,
				totalBitrate	: layer.totalBitrate,
				targetBitrate	: layer.targetBitrate,
				targetWidth	: layer.targetWidth,
				targetHeight	: layer.targetHeight,
				targetFps	: layer.targetFps,
				width		: layer.width,
				height		: layer.height,
				codec		: layer.codec,
			};

			//Append to encoding
			encoding.layers.push(layerStats);
			//Append to all layer list
			all.push({ encodingId: id, ...layerStats });
		}
			
		//Check if the encoding had svc layers
		if (encoding.layers.length)
			//Order layer list based on bitrate
			encoding.layers = encoding.layers.sort(sortByBitrateReverse);
		else
			//Add encoding as layer
			all.push({
				encodingId	: encoding.id,
				simulcastIdx	: encoding.simulcastIdx,
				spatialLayerId	: LayerInfo.MaxLayerId,
				temporalLayerId	: LayerInfo.MaxLayerId,
				totalBytes	: encoding.totalBytes,
				numPackets	: encoding.numPackets,
				bitrate		: encoding.bitrate,
				totalBitrate	: encoding.totalBitrate,
				targetBitrate	: encoding.targetBitrate,
				targetWidth	: encoding.targetWidth,
				targetHeight	: encoding.targetHeight,
				targetFps	: encoding.targetFps,
				width		: encoding.width,
				height		: encoding.height,
				codec		: encoding.codec,
			});
				
		//Add to encoding list
		active.push(encoding);
	}
			
	//Return ordered info
	return {
		active		: active.sort(sortByBitrateReverse),
		inactive	: inactive, 
		layers          : all.sort(sortByBitrateReverse)
	};
}

export type NativeSourceMap = { [id: string]: SharedPointer.Proxy<Native.RTPIncomingSourceGroupShared> };

/** IncomingStreamTrack Events Type */
export interface IncomingStreamTrackEvents<Self, Encoding> {
	/** New encoding (right now, this is only used by {@link IncomingStreamTrackMirrored} and {@link IncomingStreamTrackSimulcastAdapter}) */
    encoding: (self: Self, encoding: Encoding) => void;
	/** The encoding has been removed */
    encodingremoved: (self: Self, encoding: Encoding) => void;
    attached: (self: Self) => void;
    detached: (self: Self) => void;
    muted: (muted: boolean) => void;
    stopped: (self: Self, stats?: IncomingTrackStats) => void;
}

/**
 * Audio or Video track of a remote media stream
 */
export class IncomingStreamTrack extends Emitter<IncomingStreamTrackEvents<IncomingStreamTrack, Encoding>>
{
	readonly id: string;
    readonly mediaId: string;
    readonly media: TrackType;
    readonly receiver: SharedPointer.Proxy<Native.RTPReceiverShared>;
    muted: boolean = false;
    counter: number = 0;
    stats: IncomingTrackStats = {};
    trackInfo: TrackInfo;
    encodings: Map<string, Encoding>;
    simulcastDepacketizer?: SharedPointer.Proxy<Native.SimulcastMediaFrameListenerShared>;
    depacketizer: SharedPointer.Proxy<Native.SimulcastMediaFrameListenerShared | Native.RTPIncomingMediaStreamDepacketizerShared>;
    private stopped?: boolean;
    private h264ParameterSets?: string;

	constructor(
        media: TrackType,
        id: string,
        mediaId: string,
        timeService: Native.TimeService,
        receiver: SharedPointer.Proxy<Native.RTPReceiverShared>,
        sources: NativeSourceMap
    ) {
		//Init emitter
		super();

		//Store track info
		this.id		= id;
		this.mediaId	= mediaId;
		this.media	= media;
		this.receiver	= receiver;
		//Not muted
		this.muted = false;
		//Attach counter
		this.counter	= 0;

		//Cached stats
		this.stats =  {};
	
		//Create info
		this.trackInfo = new TrackInfo(media, id);
		
		//Create source map
		this.encodings = new Map<string, Encoding>();

		//Get number of encodings
		const num = Object.keys(sources).length;

		//If multiple sources and got time service
		if (num > 1 && timeService)
		{
			//Create a simulcast frame listerner for selecting best frame from all sources
			this.simulcastDepacketizer =  SharedPointer.SharedPointer(new Native.SimulcastMediaFrameListenerShared(timeService, 1, num));
			//Use it as default
			this.depacketizer = this.simulcastDepacketizer;
		}
		
		//For each source
		for (let [id, source] of Object.entries(sources)) {
			//Add source
			this.addIncomingSource(id, source);
		}

		//If there is no simulcast depacketizer used
		// @ts-ignore
		if (!this.depacketizer) {
			//This is the single depaquetizer, so reause it
			this.depacketizer = this.getDefaultEncoding().depacketizer;
		}
	}

	addIncomingSource(id: string, source: SharedPointer.Proxy<Native.RTPIncomingSourceGroupShared>): void
	{
		//The encoding
		const encoding = {
			id		: id,
			source		: source,
			receiver	: this.receiver,
			depacketizer	: SharedPointer.SharedPointer(new Native.RTPIncomingMediaStreamDepacketizerShared(source.toRTPIncomingMediaStream()))
		};
			
		//Push new encoding
		this.encodings.set(id, encoding);
			
		//If multiple encodings
		if (this.simulcastDepacketizer)
			//Add the source depacketizer producer
			this.simulcastDepacketizer.AttachTo(encoding.depacketizer.toMediaFrameProducer());
			
		//Add ssrcs to track info
		source.media && source.media.ssrc && this.trackInfo.addSSRC(source.media.ssrc);
		source.rtx && source.rtx.ssrc && this.trackInfo.addSSRC(source.rtx.ssrc);
			
		//Add RTX groups
		source.rtx && source.rtx.ssrc && this.trackInfo.addSourceGroup(new SourceGroupInfo("FID",[source.media.ssrc,source.rtx.ssrc]));
			
		//If doing simulcast
		if (id)
		{
			//Create simulcast info
			const encodingInfo = new TrackEncodingInfo(id, false);
			//If we have ssrc info also
			if (source.media && source.media.ssrc)
				//Add main ssrc
				encodingInfo.addParam("ssrc",String(source.media.ssrc));
			//Add it
			this.trackInfo.addEncoding(encodingInfo);
		}

		//Init stats
		this.stats[encoding.id] = getEncodingStats(encoding);

		//Emit encoding event, nobody will be listening when called from constructor
		this.emit("encoding", this, encoding);
	}
	
	/**
	 * Get stats for all encodings 
	 * @returns {Promise<IncomingTrackStats>}
	 */
	async getStatsAsync(): Promise<IncomingTrackStats>
	{
		//Get current timestamp
		const ts = Date.now();
		//For each encoding
		for (let encoding of this.encodings.values())
		{
			//Check if we have cachedd stats
			if (encoding.source && (!this.stats[encoding.id] || (ts - this.stats[encoding.id].timestamp)>100))
			{
				//If it was updated to long ago
				if ((ts - encoding.source.lastUpdated)>100)
					//Update stats async
					await new Promise(resolve=>encoding.source.UpdateAsync({resolve}));
				//If not stopped while waiting
				if (encoding.source)
					//Push new encoding
					this.stats[encoding.id] = getEncodingStats(encoding);
			}
		}
		
		//Update silmulcast index for layers
		updateStatsSimulcastIndexAndCodec(this.stats);

		//Return a clone of cached stats;
		return this.stats;
	}

	/**
	 * Get stats for all encodings 
	 * @returns {IncomingTrackStats}
	 */
	getStats(): IncomingTrackStats
	{
		//Get current timestamp
		const ts = Date.now();
		//For each encoding
		for (let encoding of this.encodings.values())
		{
			//Check if we have cachedd stats
			if (encoding.source && (!this.stats[encoding.id] || (ts - this.stats[encoding.id].timestamp)>100))
			{
				//If it was updated to long ago
				if ((ts - encoding.source.lastUpdated)>100)
					//Update stats
					encoding.source.Update();
				//Push new encoding
				this.stats[encoding.id] = getEncodingStats(encoding);
			}
		}
		
		//Update silmulcast index for layers
		updateStatsSimulcastIndexAndCodec(this.stats);
		
		//Return stats
		return this.stats;
	}
	
	/**
	 * Get active encodings and layers ordered by bitrate
	 * @returns {ActiveLayersInfo} Active layers object containing an array of active and inactive encodings and an array of all available layer info
	 */
	getActiveLayers(): ActiveLayersInfo
	{
		//Get track stats
		const stats = this.getStats();
		
		//Get active layers from stats
		return getActiveLayersFromStats(stats);
	}

	/**
	 * Get active encodings and layers ordered by bitrate
	 * @returns {Promise<ActiveLayersInfo>} Active layers object containing an array of active and inactive encodings and an array of all available layer info
	 */
	async getActiveLayersAsync(): Promise<ActiveLayersInfo>
	{
		//Get track stats
		const stats = await this.getStatsAsync();
		
		//Get active layers from stats
		return getActiveLayersFromStats(stats);
	}

	/**
	* Get track id as signaled on the SDP
	*/
	getId(): string
	{
		return this.id;
	}
	
	/**
	* Get track media id
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
	 * @returns {{ [encodingId: string]: { media: number, rtx: number } }}
	 */
	getSSRCs(): { [encodingId: string]: SSRCs }
	{
		const ssrcs: { [encodingId: string]: { media: number, rtx: number } }  = {};
		
		//For each source
		for (let encoding of this.encodings.values())
			//Push new encoding
			ssrcs[encoding.id] = {
				media : encoding.source.media.ssrc,
				rtx   : encoding.source.rtx.ssrc
			};
		//Return the stats array
		return ssrcs;
	}
	
	/**
	* Get track media type
	* @returns {TrackType}
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
	 * Signal that this track has been attached.
	 * Internal use, you'd beter know what you are doing before calling this method
	 */
	attached(): void
	{
		//Increase attach counter
		this.counter++;
		
		//If it is the first
		if (this.counter===1) {
			this.emit("attached",this);
		}
	}
	
	/** 
	 * Request an intra refres on all sources
	 */
	refresh(): void
	{
		//For each source
		for (let encoding of this.encodings.values()) {
			//Request an iframe on main ssrc
			this.receiver.SendPLI(encoding.source.media.ssrc);
		}
	}

	/** 
	 * Reset state of incoming sources
	 */
	reset(): void
	{
		//For each source
		for (let encoding of this.encodings.values()) {
			//Reset state
			this.receiver.Reset(encoding.source.media.ssrc);
		}
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
		//For each source
		for (let encoding of this.encodings.values())
		{
			//Mute encoding
			encoding.source.Mute(muting);
			//If unmuting
			if (!muting) {
				//Request an iframe on main ssrc
				this.receiver.SendPLI(encoding.source.media.ssrc);
			}
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
	 * Return if the track is attached or not
	 */
	isAttached(): boolean
	{
		return this.counter>0;
	}

	
	/**
	 * Signal that this track has been detached.
	 * Internal use, you'd beter know what you are doing before calling this method
	 */
	detached(): void
	{
		//Decrease attach counter
		this.counter--;
		
		//If it is the last
		if (this.counter===0)
			this.emit("detached",this);
	}
	
	/**
	 * Store out of band h264 properties for this track
	 * @param {String} sprop Base64 encoded parameters from SDP
	 */
	setH264ParameterSets(sprop: string): void
	{
		this.h264ParameterSets = sprop;
	}
	
	/**
	 * Check if track has out of band h264 properties
	 * @returns {Boolean} 
	 */
	hasH264ParameterSets()
	{
		return !!this.h264ParameterSets;
	}
	
	/**
	 * Get out of band h264 parameters from this track
	 * @returns {String | undefined} 
	 */
	getH264ParameterSets()
	{
		return this.h264ParameterSets;
	}

	/**
	 * Override the maximum period of time to wait for an out of order or rtx packet
	 * @param {Number} maxWaitTime max wait time in ms (default: 0 if rtx is not supported or rtt based)
	 */
	setMaxWaitTime(maxWaitTime: number): void
	{
		//For each source
		for (let encoding of this.encodings.values())
			encoding.source.SetMaxWaitTime(maxWaitTime);
	}

	/**
	 * Remove override for the maximum period of time to wait for an out of order or rtx packet
	 */
	resetMaxWaitTime(): void
	{
		//For each source
		for (let encoding of this.encodings.values()) {
			encoding.source.ResetMaxWaitTime();
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
		
		//for each encoding
		for (let encoding of this.encodings.values())
		{	
			//If we are using a simulcast depacketizer for multiple encodings
			if (this.simulcastDepacketizer)
				//Remove frame listener
				this.simulcastDepacketizer.Detach(encoding.depacketizer.toMediaFrameProducer());
			//Stop the depacketizer
			encoding.depacketizer.Stop();
			//Stop source
			encoding.source.Stop();
			//Get last stats
			this.stats[encoding.id] = getEncodingStats(encoding);
		}

		//Stop global depacketizer
		if (this.depacketizer) this.depacketizer.Stop();
		
		this.emit("stopped",this,this.stats);
		
		//Stop emitter
		super.stop();
		
		//remove encodings
		this.encodings.clear();
		//@ts-expect-error
		this.depacketizer = null;
		
		//Remove transport reference, so destructor is called on GC
		//@ts-expect-error
		this.receiver = null;
	}

	static sortByBitrateReverse = sortByBitrateReverse;
    static getActiveLayersFromStats = getActiveLayersFromStats;
    static updateStatsSimulcastIndexAndCodec = updateStatsSimulcastIndexAndCodec;
}
