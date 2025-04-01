import * as Native from "./Native";
import { MediaInfo, SDPInfo, MediaInfoLike, TrackType } from "semantic-sdp";

interface RTPProperties {
    audio?: MediaInfoLike;
    video?: MediaInfoLike;
}

function ensureString(str: any): string {
    return "string" === typeof str ? str : String(str);
}

function parseRTPProperties(rtp: RTPProperties | SDPInfo): RTPProperties {
    if (rtp.constructor.name === "SDPInfo") {
        const sdpInfo = rtp as SDPInfo;
        return {
            audio: sdpInfo.getMedia("audio"),
            video: sdpInfo.getMedia("video"),
        };
    }
    return rtp as RTPProperties;
}

function convertRTPProperties(rtp: RTPProperties): Native.Properties
{
	//Create new native properties object
	const properties = new Native.Properties();

	//If we have got audio
	if (rtp.audio)
	{
		let num = 0;
		
		//Supppor plain and Semantic SDP objects
		const audio = MediaInfo.expand(rtp.audio);

		//For each codec
		for (const codec of audio.getCodecs().values())
		{
			const item = `audio.codecs.${num}`;

			//Put codec
			properties.SetStringProperty(`${item}.codec`, ensureString(codec.getCodec()));
			properties.SetIntegerProperty(`${item}.pt`, codec.getType());

			//If it has rtx
			if (codec.rtx) {
				properties.SetIntegerProperty(`${item}.rtx`, codec.getRTX());
			}
			
			num++;
		}

		//Set length
		properties.SetIntegerProperty("audio.codecs.length", num);
		 
		//Reset
		num = 0;
		 
		//For each extension
		for (const [id,uri] of audio.getExtensions().entries())
		{
			properties.SetIntegerProperty(`audio.ext.${num}.id`, id);
            properties.SetStringProperty(`audio.ext.${num}.uri`, ensureString(uri));
            num++;
		}

		//Set length
		properties.SetIntegerProperty("audio.ext.length", num);
	}

	//If we have video
	if (rtp.video)
	{
		let num = 0;
		
		// Support plain and Semantic SDP objects
        const video = MediaInfo.expand(rtp.video);

		//For each codec
		for (const codec of video.getCodecs().values())
		{
			const item = `video.codecs.${num}`;

			// Put codec
            properties.SetStringProperty(`${item}.codec`, ensureString(codec.getCodec()));
            properties.SetIntegerProperty(`${item}.pt`, codec.getType());

			//If it has rtx
			if (codec.rtx)
				properties.SetIntegerProperty(`${item}.rtx`, codec.getRTX());

			num++;
		}

		//Set length
		properties.SetIntegerProperty("video.codecs.length", num);
		 
		//Reset
		num = 0;
		 
		//For each extension
		for (const [id,uri] of video.getExtensions().entries())
		{
			properties.SetIntegerProperty(`video.ext.${num}.id`, id);
            properties.SetStringProperty(`video.ext.${num}.uri`, String(uri));
            num++;
		}

		//Set length
		properties.SetIntegerProperty("video.ext.length", num);
	}

	return properties;
};

function mediaToFrameType(media: TrackType): Native.MediaFrameType {
    switch(media.toLowerCase()) {
        case "audio":
            return 0 as Native.MediaFrameType;
        case "video":
            return 1 as Native.MediaFrameType;
        default:
            throw new Error("Incorrect media type");
    }
}

export {
    parseRTPProperties,
    convertRTPProperties,
    mediaToFrameType,
    RTPProperties
};
