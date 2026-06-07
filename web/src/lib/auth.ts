import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // VPS / reverse-proxy / доступ по IP — иначе Auth.js v5 даёт UntrustedHost (500 на /api/auth/*).
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        login: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
        mode: { label: "Режим", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.login) return null;

        const normalizedLogin = (credentials.login as string)
          .trim()
          .toLowerCase();
        if (!normalizedLogin) return null;

        const user = await prisma.user.findUnique({
          where: { login: normalizedLogin },
          include: { employee: true },
        });

        if (!user) return null;

        const isAdminUser = ["admin", "schedule_manager"].includes(user.role);
        const mode = credentials.mode === "admin" ? "admin" : "worker";

        if (mode === "admin") {
          // Админ-режим: только админ-аккаунты и только с паролем.
          if (!isAdminUser) return null;
          if (!credentials.password) return null;
          const valid = await compare(
            credentials.password as string,
            user.passwordHash
          );
          if (!valid) return null;
        } else {
          // Режим работника: вход по фамилии без пароля.
          // Админ-аккаунты так пускать нельзя — для них только админ-режим.
          if (isAdminUser) return null;
        }

        return {
          id: user.id,
          name: user.employee?.name ?? user.login,
          role: user.role,
          employeeId: user.employeeId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.employeeId = (user as { employeeId: string | null }).employeeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as { role: string }).role = token.role as string;
        (session.user as { employeeId: string | null }).employeeId =
          token.employeeId as string | null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});
