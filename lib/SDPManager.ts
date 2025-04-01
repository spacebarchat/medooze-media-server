import Emitter from "medooze-event-emitter";
import { Transport } from "./Transport";

export type SDPState = "initial" | "local-offer" | "remote-offer" | "stable";

interface SDPManagerEvents {
    stopped: (self: SDPManager) => void;
    transport: (transport: Transport) => void;
    renegotiationneeded: (transport: Transport) => void;
}

export class SDPManager extends Emitter<SDPManagerEvents>
{
	state: SDPState;
    transport: Transport | null;
	
	constructor()
	{
		//Init emitter
		super();

		//SDP O/A state
		this.state = "initial";
		this.transport = null;
	}
	
	/**
	 * Get current SDP offer/answer state 
	 */
	getState(): SDPState
	{
		return this.state;
	}
	
	/**
	 * Returns the Transport object created by the SDP O/A
	 */
	getTransport(): Transport | null
	{
		return this.transport;
	}
	
	/**
	 * Create local description
	 */
	createLocalDescription(): string {
		throw new Error('not implemented');
	}
	
	/**
	 * Process remote offer
	 * @param {String} sdp	- Remote session description
	 */
	processRemoteDescription(sdp: string){
		throw new Error('not implemented');
	}
	
	/**
	 * Stop manager and associated tranports
	 */
	stop(): void
	{
		this.emit("stopped",this);
	
		//Stop emitter
		super.stop();
	}
	
}
