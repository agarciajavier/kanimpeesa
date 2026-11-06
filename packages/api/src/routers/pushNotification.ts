import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as pushSubscriptionRepo from "@kan/db/repository/pushSubscription.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getVapidPublicKey } from "../utils/push";

// Impeesa: turning push notifications on and off for the current device.

const requireUser = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

const endpointSchema = z.string().url().max(2048);

export const pushNotificationRouter = createTRPCRouter({
  // The browser needs the public key to subscribe; null while push isn't set
  // up on the server.
  config: protectedProcedure
    .input(z.object({ endpoint: endpointSchema.nullish() }))
    .query(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      return {
        publicKey: getVapidPublicKey(),
        isSubscribed: input.endpoint
          ? await pushSubscriptionRepo.isSubscribed(ctx.db, {
              userId,
              endpoint: input.endpoint,
            })
          : false,
      };
    }),
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: endpointSchema,
        p256dh: z.string().min(1).max(255),
        auth: z.string().min(1).max(255),
        userAgent: z.string().max(512).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      await pushSubscriptionRepo.upsert(ctx.db, {
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      });
      return { success: true };
    }),
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: endpointSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx.user?.id);
      await pushSubscriptionRepo.removeForUser(ctx.db, {
        userId,
        endpoint: input.endpoint,
      });
      return { success: true };
    }),
});
