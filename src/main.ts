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
     * Options for the initial SurrealDB connection.
     * You should set the namespace and database in this object.
    */
    connectionOpts: Parameters<Surreal['connect']>[1];
    /**
    * Sign-in options
    * @deprecated Use SurrealDBStoreOptions.connectionOpts instead (fixes reconnection issues). This will be removed in a future release.
    */
    signinOpts?: Parameters<Surreal['signin']>[0];

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
     * @deprecated Use SurrealDBStoreOptions.connectionOpts instead (fixes reconnection issues). This will be removed in a future release.
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
        error?: (any) => void,
        info?: (any) => void,
        debug?: (any) => void,
    };

    /**
     * Custom setter function for storing session data. If provided, this function will be used instead of the default upsert logic.
     */
    customSetter?: (db: Surreal, sessionId: string, session: SessionData) => Promise<any>;

    /**
     * Custom getter function for retrieving session data. If provided, this function will be used instead of the default select logic.
     */
    customGetter?: (db: Surreal, sessionId: string) => Promise<SessionData | null>;
};

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
            .then(async () => {
                this.hasConnected = true;
                options.logger?.info?.("SurrealDBStore: Creating schema...");
                try {
                    await this.db.query(`DEFINE TABLE OVERWRITE ${this.tableName} COMMENT 'Automatically created by express-session SurrealDB Store'`);
                    options.logger?.info?.("SurrealDBStore: Schema created successfully.");
                }
                catch (err) {
                    options.logger?.error?.("SurrealDBStore: Failed to create schema: " + err.message);
                }
            });


        if (this.options.autoSweepExpired) {
            const intervalMs = this.options.autoSweepIntervalMs ?? 10 * 60 * 1000;
            setInterval(() => {
                this.db.query(
                    `DELETE type::table($table) WHERE expires < time::now()`,
                    { table: this.tableName }
                ).then(() => {
                    options.logger?.info?.(`SurrealDBStore: Swept expired sessions from table ${this.tableName}`);
                }).catch(err => {
                    options.logger?.error?.(`SurrealDBStore: Failed to sweep expired sessions: ${err.message}`);
                });
            }, intervalMs);
        }
    }

    /**
     * Perform the initial connection to the database. This also sets the scope of our connection.
     */
    private async _connect() {
        this.options.logger?.info?.("SurrealDBStore: Connecting to SurrealDB...");
        const connectionOpts: Parameters<Surreal['connect']>[1] = {
            namespace: this.options.useOpts?.namespace,
            database: this.options.useOpts?.database,
            authentication: this.options.signinOpts as any,
            ...this.options.connectionOpts,
        };

        await this.db.connect(this.options.url, connectionOpts)
            .then(() => {
                this.hasConnected = true;
                this.options.logger?.info?.("SurrealDBStore: Connected to SurrealDB.");
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to connect to SurrealDB!\n" + err.message + '\n' + err.stack);
            });
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

        this.options.logger?.debug?.("SurrealDBStore: Getting session data for session ID: " + sessionId);
        getter
            .then((res) => {
                this.options.logger?.debug?.("SurrealDBStore: Got session data for session ID: " + sessionId);
                cb(null, res);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to get session data for session ID: " + sessionId + "\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }

    /**
     * Set session data for a given session ID
     */
    set(sessionId: string, session: SessionData, cb: Function) {
        const setter = this.options.customSetter
            ? this.options.customSetter(this.db, sessionId, session)
            : this.db.upsert(new RecordId(this.tableName, sessionId)).content(session as any);

        this.options.logger?.debug?.("SurrealDBStore: Setting session data for session ID: " + sessionId);
        setter
            .then((res) => {
                this.options.logger?.debug?.("SurrealDBStore: Set session data for session ID: " + sessionId);
                cb(null, res);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to set session data for session ID: " + sessionId + "\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }

    touch(sid: string, session, cb: Function) {
        // TODO: The schema of the table should be automatically
        // generated and should have a TTL on sessions
        this.set(sid, session, cb);
    }

    destroy(sessionId: string, cb: Function) {
        this.db.delete(new RecordId(this.tableName, sessionId))
            .then(() => {
                this.options.logger?.debug?.("SurrealDBStore: Destroyed session data for session ID: " + sessionId);
                cb(null);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to destroy session data for session ID: " + sessionId + "\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }

    length(cb: Function) {
        this.db.query(`SELECT count() FROM type::table($table) GROUP ALL`, { 'table': this.tableName })
            .collect()
            .then(([result]) => {
                this.options.logger?.debug?.("SurrealDBStore: Got session count: " + result[0].count);
                cb(result[0].count);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to get session count\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }

    all(cb: Function) {
        this.db.select(new Table(this.tableName))
            .then(([result]) => {
                this.options.logger?.debug?.("SurrealDBStore: Got all session data");
                cb(result);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to get all session data\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }

    clear(cb: Function) {
        this.db.query(`DELETE type::table($table)`, { 'table': this.tableName })
            .then(() => {
                this.options.logger?.debug?.("SurrealDBStore: Cleared all session data");
                cb(null);
            })
            .catch(err => {
                this.options.logger?.error?.("SurrealDBStore: Failed to clear all session data\n" + err.message + '\n' + err.stack);
                cb(err);
            });
    }
}
