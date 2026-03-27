# HomeEase Services

A modern, responsive full-stack website for a home services marketplace (like Urban Company).

## Project Structure

- `index.html` – Home page
- `services.html` – Services listing page
- `booking.html` – Booking page
- `about.html` – About Us page
- `contact.html` – Contact page
- `login.html` – Login/Signup page
- `admin.html` – Admin bookings dashboard
- `style.css` – Shared styles
- `script.js` – Frontend scripting and local storage logic
- `server.js` – Node.js + Express backend APIs
- `package.json` – Node project dependencies
- `.env.example` – Example environment variables

## Features Implemented

- Clean modern UI with blue/white professional theme
- Responsive layout for mobile to desktop
- Service search and filtering
- Booking form with price estimation
- Testimonials and highlighted services
- Contact form
- Login/Register stubs
- Local storage fallback for bookings if server unavailable
- Express backend for booking persistence
- MongoDB optional storage (via `MONGO_URI`)
- Admin endpoint with bearer token auth
- Static assets served from project root

## Setup (Frontend + Backend)

1. Copy project folder and open terminal in `homeease`.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` from `.env.example` with proper values:

```
PORT=5000
MONGO_URI="mongodb+srv://<user>:<pass>@cluster0.mongodb.net/homeease?retryWrites=true&w=majority"
ADMIN_TOKEN=admin-secret
```

4. Start the server:

```bash
npm run dev
```

5. Open browser:

`http://localhost:5000`

## APIs

- `POST /api/register` — create account; body includes `name`, `email`, `password`.
- `POST /api/login` — login; body includes `email`, `password`.
- `POST /api/refresh-token` — refresh access token; body includes `refreshToken`.
- `POST /api/logout` — invalidate refresh token; body includes `refreshToken`.
- `GET /api/profile` — current profile (auth required: `Authorization: Bearer <accessToken>`).
- `GET /api/bookings` — list all bookings.
- `POST /api/bookings` — create booking payload (JSON required); auth token optionally used.
- `GET /api/admin/bookings` — admin-only; auth token `Authorization: Bearer <accessToken>`.
- `POST /api/contact` — create contact message.
- `GET /api/contact` — list contact messages (auth required).
- `GET /api/testimonials` — list testimonials.
- `POST /api/testimonials` — create testimonial (auth required).

### Booking JSON format

```json
{
  "name": "John Doe",
  "phone": "9999999999",
  "address": "123 Main Street",
  "date": "2026-04-10",
  "serviceType": "AC Repair & Installation",
  "price": "1500",
  "notes": "Please call before arrival."
}
```

## Admin Testing

1. Open `http://localhost:5000/admin.html`
2. It reads from localStorage by default.
3. To test API admin route:

```bash
curl -H "Authorization: Bearer admin-secret" http://localhost:5000/api/admin/bookings
```

## Optional Enhancements

- Add real login/signup with authentication (JWT)
- Implement search autocomplete + category filters
- Add OTP integration or external SMS service
- Add map/location detection via Geolocation API
- Add rating and review persistence in DB
