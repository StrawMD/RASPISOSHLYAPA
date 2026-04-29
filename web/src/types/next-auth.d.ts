import "next-auth";

declare module "next-auth" {
  interface User {
    role: string;
    employeeId: string | null;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      role: string;
      employeeId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    employeeId: string | null;
  }
}
