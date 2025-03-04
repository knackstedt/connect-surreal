import { SessionData, Store } from "express-session";
import WebSocketStrategy, { r, RecordId, Surreal } from "surrealdb";


export type SurrealDBStoreOptions = {
    /**
     * URL used to connect to SurrealDB
     * e.g. http://127.0.0.1:8000/rpc
     */
    url: string,
    /**
     * Table to use for storing the sessions
     * @default `user_sessions`
     */
    tableName: string,

    /**
     * Options for the initial SurrealDB connection
    */
    connectionOpts: Parameters<Surreal['connect']>[1];
    /**
    * Sign-in options
    */
    signinOpts: Parameters<WebSocketStrategy['signin']>[0];


    /**
     * Use options (Select namespace, database)
     * @optional
     */
    useOpts?: Parameters<WebSocketStrategy['use']>[0];
    /**
     * Optional surreal db instance override.
     */
    surreal?: Surreal,
}

export class SurrealDBStore extends Store {

    private db: Surreal;
    private tableName: string;
    private lastConnectionAttempt = 0;
    private hasConnected = false;
    private isConnected = false;

    constructor(private readonly options: SurrealDBStoreOptions) {
        super();

        this.db = options.surreal ?? new Surreal();

        // Re-connect
        this.db.emitter.subscribe("disconnected", () => {
            this.isConnected = false;
            this._reconnect();
        });

        // Preventative for SQLi if the developer hasn't hardcoded this.
        if (options.tableName && /^[a-zA-Z0-9]+$/.test(options.tableName))
            throw new Error("Invalid table name.");

        this.tableName = options.tableName ?? 'user_sessions';

        this._connect().catch(err => {
            console.error("Failed to connect express-session SurrealDB Store to database!\n" + err.message + '\n' + err.stack);
        });
    }

    /**
     * Perform the initial connection to the database. This also sets the scope of our connection.
     */
    private async _connect() {
        await this.db.connect(this.options.url, this.options.connectionOpts);
        await this.db.signin(this.options.signinOpts);

        if (this.options.useOpts) {
            await this.db.use(this.options.useOpts);
        }

        this.isConnected = true;
    }

    /**
     * Reconnect to the database if our connection drops. This uses a connection
     * throttling technique to prevent connection storming.
     */
    private async _reconnect() {
        if (this.isConnected) return;

        // If this last tried to connect under 5 seconds ago, abort.
        // This prevents overloading the network with connection attempts.
        if (Date.now() - this.lastConnectionAttempt < 5000) {
            if (this.hasConnected) {
                console.error("The connection to SurrealDB appears to have dropped.");
            }
            else {
                console.error("Cannot reconnect to SurrealDB.");
            }
            return;
        }

        this.lastConnectionAttempt = Date.now();
        await this.db.connect(this.options.url, this.options.connectionOpts)
            .then(() => {
                this.isConnected = true;
            });
    }

    /**
     * Check the connection state and attempt to reconnect before continuing
     * This ensures that sessions shouldn't observe disruptions in edge cases
     * where the connection gets lost and we can't connect immediately.
     *
     * If there's 50 minutes between the drop and a new connection, the user won't
     * get an error screen and need to refresh their page.
     */
    private async _checkConnectionAndReconnect() {
        if (!this.isConnected) {
            if (this.hasConnected) {
                // The connection has dropped once and we just need to reconnect.
                await this._reconnect();
            }
            else {
                // In the case where the initial connection
                // fails and is resolved after startup.
                await this._connect();
            }
        }
    }

	get(sessionId: string, cb: Function) {
        this._checkConnectionAndReconnect()
        .then(() => {
            this.db.select(new RecordId(this.tableName, sessionId))
                .then((res) => cb(null, res))
                .catch(err => cb(err))
        })
        .catch(err => cb(err))
    }

    set(sessionId: string, session, cb: Function) {
        this._checkConnectionAndReconnect()
            .then(() => {
                this.db.upsert(new RecordId(this.tableName, sessionId), session)
                    .then((res) => cb(null, res))
                    .catch(err => cb(err));
            })
            .catch(err => cb(err))
    }

    touch(sid: string, session, cb: Function) {
        // TODO: The schema of the table should be automatically
        // generated and should have a TTL on sessions
        this.set(sid, session, cb);
    }

	destroy (sessionId: string, cb: Function) {
        this.db.delete(new RecordId(this.tableName, sessionId))
            .then(() => cb(null))
            .catch(err => cb(err))
    }

	length(cb: Function) {
        this.db.query(`SELECT count() from $p group by count`, { 'p': this.tableName })
            .then(([result]) => cb(result[0].count))
            .catch(err => cb(err))
    }

	all(cb: Function) {
        this.db.select(this.tableName)
            .then(([result]) => cb(result))
            .catch(err => cb(err))
    }

	clear(cb: Function) {
        this.db.query(`DELETE $p`, { 'p': this.tableName })
            .then(() => cb(null))
            .catch(err => cb(err))
    }
}
