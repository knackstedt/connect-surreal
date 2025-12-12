import { type SessionData, Store } from "express-session";
import { RecordId, Surreal, Table } from "surrealdb";


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
    signinOpts: Parameters<Surreal['signin']>[0];

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
    useOpts?: Parameters<Surreal['use']>[0];
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

    // Has the store ever successfully connected
    private hasConnected = false;
    // Is currently connected
    private isConnected = false;

    constructor(private readonly options: SurrealDBStoreOptions) {
        super();

        this.db = options.surreal ?? new Surreal();

        this.tableName = options.tableName ?? 'user_session';

        this._connect()
            .then(() => {
                this.hasConnected = true;
                options.logger?.info("SurrealDBStore connected to database.");
            })
            .catch(err => {
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
        this.hasConnected = true;
    }

    /**
     * Get session data by session ID
     */
	get(sessionId: string, cb: Function) {
        const getter = this.options.customGetter
            ? this.options.customGetter(this.db, sessionId)
            : this.db.select(new RecordId(this.tableName, sessionId));

        getter
            .then((res) => cb(null, res))
            .catch(err => cb(err))
    }

    /**
     * Set session data for a given session ID
     */
    set(sessionId: string, session: SessionData, cb: Function) {
        const setter = this.options.customSetter
            ? this.options.customSetter(this.db, sessionId, session)
            : this.db.upsert(new RecordId(this.tableName, sessionId)).content(session as any);

        setter
            .then((res) => cb(null, res))
            .catch(err => cb(err));
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
            .collect()
            .then(([result]) => cb(result[0].count))
            .catch(err => cb(err))
    }

	all(cb: Function) {
        this.db.select(new Table(this.tableName))
            .then(([result]) => cb(result))
            .catch(err => cb(err))
    }

	clear(cb: Function) {
        this.db.query(`DELETE type::table($table)`, { 'table': this.tableName })
            .then(() => cb(null))
            .catch(err => cb(err))
    }
}
