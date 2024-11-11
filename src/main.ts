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

    constructor(private readonly options: SurrealDBStoreOptions) {
        super();

        this.db = options.surreal ?? new Surreal();

        // Preventative for SQLi if the developer hasn't hardcoded this.
        if (options.tableName && /^[a-zA-Z0-9]+$/.test(options.tableName))
            throw new Error("Invalid table name.");

        this.tableName = options.tableName ?? 'user_sessions';

        this._connect().catch(err => {
            console.error("Failed to connect express-session SurrealDB Store to database!\n" + err.message + '\n' + err.stack);
        });
    }

    private async _connect() {
        await this.db.connect(this.options.url, this.options.connectionOpts);
        await this.db.signin(this.options.signinOpts);
        if (this.options.useOpts)
            await this.db.use(this.options.useOpts)
    }

	get(sessionId: string, cb: Function) {
        this.db.select(new RecordId(this.tableName, sessionId))
            .then((res) => cb(null, res))
            .catch(err => cb(err))
    }

    set(sessionId: string, session, cb: Function) {
        // should this be a record (r)?
        this.db.upsert(new RecordId(this.tableName, sessionId), session)
            .then(() => cb(null))
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
