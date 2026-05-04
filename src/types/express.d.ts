declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        /** Role slug */
        role: string
        permissions: string[]
      }
    }
  }
}

export {}
