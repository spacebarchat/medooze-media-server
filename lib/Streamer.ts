import Emitter from "medooze-event-emitter";
import {StreamerSession, StreamerSessionOptions} from "./StreamerSession";
import { MediaInfo } from "semantic-sdp";

interface StreamerEvents {
    stopped: (self: Streamer) => void;
}

/**
 * An streamer allows to send and receive plain RTP over udp sockets.
 * This allows both to bridge legacy enpoints or integrate streaming/broadcasting services.
 */
export class Streamer extends Emitter<StreamerEvents>
{
	ip?: string;
    sessions: Set<StreamerSession>;

	constructor(ip?: string)
	{
		//Init emitter
		super();

		//Store ip address of the endpoint
		this.ip = ip;
		//Sessions set
		this.sessions = new Set<StreamerSession>();
	}
	
	/**
	 * Creates a new streaming session from a media description
	 * @param {MediaInfo} media - Media codec description info
	 * @param {StreamerSession.StreamerSessionOptions} [params] - Network parameters
	 * @returns {StreamerSession} The new streaming session
	 */
	createSession(media: MediaInfo, params?: StreamerSessionOptions): StreamerSession
	{
		//Create session
		const session = new StreamerSession(media,params);
		
		//Add listener
		session.once("stopped",()=>{
			//Remove from set
			this.sessions.delete(session);
		});
		//Store it
		this.sessions.add(session);
		
		//Return it
		return session;
	}
	
	/**
	 * Stop all streaming sessions and frees resources
	 */
	stop(): void 
	{
		//Stop all sessions
		for (let session of this.sessions.values()) {
			//stop
			session.stop();
		}

		this.emit("stopped",this);

		//Stop emitter
		super.stop();
		
		//Clear set jic
		this.sessions.clear();
	}
}