import express from 'express';
import session from 'express-session';
import { SurrealDBStore } from '../main';

const app = express();
const PORT = 3030;

app.use(session({
    secret: '123545',
    saveUninitialized: false,
    resave: false,
    proxy: true,
    cookie: {
        sameSite: "lax",
        secure: false,
        httpOnly: false,
        maxAge: 1000 * 60 * 60 * 24 * 1
    },
    store: new SurrealDBStore({
        url: 'ws://localhost:8000',
        signinOpts: {
            username: 'root',
            password: 'root',
        },
        connectionOpts: {
            namespace: 'test',
            database: 'test',
        },
        tableName: 'session'
    })
}))
app.get('/', (req, res) => {
    // @ts-ignore
    req.session.views = (req.session.views || 0) + 1;
    res.send('Hello, world!');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
