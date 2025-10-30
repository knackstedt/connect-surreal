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
     * Automatically sweep and remove expired sessions periodically.
     * @default false
     */
    autoSweepExpired?: boolean;

    /**
     * Interval in milliseconds to sweep for expired sessions.
     * @default 600000 (10 minutes)
     */
    autoSweepIntervalMs?: number;


    /**
     * Use options (Select namespace, database)
     * @optional
     */
    useOpts?: Parameters<WebSocketStrategy['use']>[0];
    /**
     * Optional surreal db instance override.
     */
    surreal?: Surreal,

    /**
     * Optional logger
     */
    logger?: {
        error: (any) => void,
        info: (any) => void,
        debug: (any) => void,
    }

    /**
     * Custom setter function for storing session data. If provided, this function will be used instead of the default upsert logic.
     */
    customSetter?: (db: Surreal, sessionId: string, session: SessionData) => Promise<any>;

    /**
     * Custom getter function for retrieving session data. If provided, this function will be used instead of the default select logic.
     */
    customGetter?: (db: Surreal, sessionId: string) => Promise<SessionData | null>;
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

        this.db.emitter.subscribe('error', options.logger?.error);

        // Re-connect
        this.db.emitter.subscribe("disconnected", () => {
            this.isConnected = false;
            this._reconnect();
        });

        this.tableName = options.tableName ?? 'user_session';

        this._connect().catch(err => {
            console.error("Failed to connect express-session SurrealDB Store to database!\n" + err.message + '\n' + err.stack);
        });

        if (this.options.autoSweepExpired) {
            const intervalMs = this.options.autoSweepIntervalMs ?? 10 * 60 * 1000;
            setInterval(() => {
                this.db.query(
                    `DELETE type::table($table) WHERE expires < time::now()`,
                    { table: this.tableName }
                ).then(() => {
                    options.logger?.info(`SurrealDBStore: Swept expired sessions from table ${this.tableName}`);
                }).catch(err => {
                    options.logger?.error(`SurrealDBStore: Failed to sweep expired sessions: ${err.message}`);
                });
            }, intervalMs);
        }
    }

    /**
     * Perform the initial connection to the database. This also sets the scope of our connection.
     */
    private async _connect() {
        await this.db.connect(this.options.url, this.options.connectionOpts);
        if (this.options.signinOpts) {
            await this.db.signin(this.options.signinOpts);
        }

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

        if (this.options.signinOpts) {
            await this.db.signin(this.options.signinOpts);
        }
        if (this.options.useOpts) {
            await this.db.use(this.options.useOpts);
        }
    }

    /**
     * Check the connection state and attempt to reconnect before continuing
     * This ensures that sessions shouldn't observe disruptions in edge cases
     * where the connection gets lost and we didn't reconnect by now.
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

    /**
     * Get session data by session ID
     */
	get(sessionId: string, cb: Function) {
        this._checkConnectionAndReconnect()
        .then(() => {
            const getter = this.options.customSetter
                ? this.options.customGetter(this.db, sessionId)
                : this.db.select(new RecordId(this.tableName, sessionId));

            getter
                .then((res) => cb(null, res))
                .catch(err => cb(err))
        })
        .catch(err => cb(err))
    }

    /**
     * Set session data for a given session ID
     */
    set(sessionId: string, session: SessionData, cb: Function) {
        this._checkConnectionAndReconnect()
            .then(() => {
                const setter = this.options.customSetter
                    ? this.options.customSetter(this.db, sessionId, session)
                    : this.db.upsert(new RecordId(this.tableName, sessionId), session as any);

                setter
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

	destroy(sessionId: string, cb: Function) {
        this.db.delete(new RecordId(this.tableName, sessionId))
            .then(() => cb(null))
            .catch(err => cb(err))
    }

	length(cb: Function) {
        this.db.query(`SELECT count() FROM type::table($table) GROUP ALL`, { 'table': this.tableName })
            .then(([result]) => cb(result[0].count))
            .catch(err => cb(err))
    }

	all(cb: Function) {
        this.db.select(this.tableName)
            .then(([result]) => cb(result))
            .catch(err => cb(err))
    }

	clear(cb: Function) {
        this.db.query(`DELETE type::table($table)`, { 'table': this.tableName })
            .then(() => cb(null))
            .catch(err => cb(err))
    }
}
