Fixed: A request the API refuses before any route runs, such as an unsupported or malformed body or one too large, is answered with its own 4xx and a stable error code instead of a 500.
