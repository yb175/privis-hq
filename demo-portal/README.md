# Demo Portal

A single static HTML page that mimics an Indian employee portal, used as a stable
target for PRIVIS demos and as a source of screenshots for fixtures.

## Why

Capture, Executor, and the privacy judges need a page with fake Indian PII
(name, PAN, salary, phone, password, avatar) without hitting any live gov/bank
site. Everything on this page is obviously fake.

## Fields

| id         | label    | value            |
|------------|----------|------------------|
| `#name`    | Name     | Asha Rao         |
| `#email`   | Email    | asha.rao@example.in |
| `#pan`     | PAN      | ABCDE1234F       |
| `#amount`  | Salary   | ₹12,00,000       |
| `#phone`   | Phone    | +91 98765 43210  |
| `#password`| Password | demo-pass-123    |
| `#submit`  | (button) | Submit           |

The avatar (`#avatar`, inline SVG) exists for the future FACE vision box.

## Run

Open directly with `file://`:

```bash
open demo-portal/index.html      # macOS
xdg-open demo-portal/index.html  # Linux
```

Or serve it with a one-line static server:

```bash
cd demo-portal && python3 -m http.server 8000
# then visit http://localhost:8000
```

## Notes

- No framework, no build step, no network requests — works fully offline.
- The form's Submit button only shows a local "submitted" message; nothing is
  sent anywhere.
- Values must stay obviously fake. Do not swap in real-looking PII.