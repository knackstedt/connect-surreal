# connect-surrealdb
> An express-session compatible store using SurrealDB as the backing database. 

Sample usage: 
```ts
import { SurrealDBStore } from 'connect-surreal';

app.use(session({
    secret: 'foobar',
    proxy: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
        path: "/",
        sameSite: "lax",
        secure: true,    // May need to set app.set('trust proxy', 1) for this to work
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 1
    },
    store: new SurrealDBStore({
        url: "http://127.0.0.1:8000/rpc",
        signinOpts: {
            username: "root",
            password: "root"
        },
        connectionOpts: {
            namespace: "nodejs",
            database: "express",
        },
        tableName: "connect-surreal"
    }),
    unset: "destroy"
}));
```
