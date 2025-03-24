const Emitter	= require("medooze-event-emitter");
const StreamerSession	= require("./StreamerSession");
const { MediaInfo } = require("semantic-sdp");

/**
 * @typedef {Object} StreamerEvents
 * @property {(self: Streamer) => void} stopped
 */

/**
 * An streamer allows to send and receive plain RTP over udp sockets.
 * This allows both to bridge legacy enpoints or integrate streaming/broadcasting services.
 * @extends {Emitter<StreamerEvents>}
 */
class Streamer extends Emitter
{
	/**
	 * @ignore
	 * @hideconstructor
	 * @param {string} [ip]
	 * private constructor
	 */
	constructor(ip)
	{
		//Init emitter
		super();

		//Store ip address of the endpoint
		this.ip = ip;
		//Sessions set
		/** @type {Set<StreamerSession>} */
		this.sessions = new Set();
	}
	
	/**
	 * Creates a new streaming session from a media description
	 * @param {MediaInfo} media - Media codec description info
	 * @param {StreamerSession.StreamerSessionOptions} [params] - Network parameters
	 * @returns {StreamerSession} The new streaming session
	 */
	createSession(media,params)
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
	stop() 
	{
		//Stop all sessions
		for (let session of this.sessions.values())
			//stop
			session.stop();

		this.emit("stopped",this);

		//Stop emitter
		super.stop();
		
		//Clear set jic
		this.sessions.clear();
	}
}

module.exports = Streamer;	
