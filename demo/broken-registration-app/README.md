# Account service

A small HTTP service for sign-up and user profiles. No dependencies; Node 20+.

```bash
npm start      # listens on :4100
npm test       # node --test
```

## API

| Method | Path | Behaviour |
| --- | --- | --- |
| `POST` | `/api/register` | Body `{ email, password, name? }`. Creates an account and responds **201** with `{ id, email, displayName, createdAt }`. `displayName` is `name`, or the part of the email before `@` when no name is given. Responds 400 for invalid input and 409 if the email is taken. |
| `GET` | `/api/users/:id/profile` | Responds 200 with the user's profile `{ displayName, bio, avatarUrl }`, or 404. |
| `GET` | `/health` | `{ status: "ok" }` |

The password hash is never returned by any endpoint.
