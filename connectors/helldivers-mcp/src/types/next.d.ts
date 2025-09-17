declare global {
  interface RequestInit {
    next?: Record<string, unknown>;
  }
}

export {};
