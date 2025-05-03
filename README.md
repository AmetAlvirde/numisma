# Create MVP App

If I wanted to creat an app to create an MVP for an idea, I would use this
as a starting point. This is the stack:

- Next.js @ 15
- Prisma ORM @ 6.7
- Tailwind @ 4
- Shadcn
- tRPC @ 11
- Storybook @ 8.6
- Next-auth @ 4.24

## The reasoning:

This is an MVP creator. Its purpose is to launch as soon as possible to either
test if there is market fit, or to solve a specific problem I have and I want
an app for that.

That's why I'm using Next.js, Tailwind and shadcn. Because that is a stack I
feel confortable with to move as fast as possible.

I'm using next-auth because I did not want to depend on Clerk or Kinde or any
other third party. Also I do not know how to use them. I surely will try them
when the purpose of the app is to learn, but for this starting point, the
purpose is to launch. That's why even using next-auth, I just shipped
email/password. Later on, and depending the market fit for the product, the
providers i'd choose to integrate.

I'm using Prisma ORM, because I know it (although db stuff is not my strongest
suit) and because I'm using its postgress service. I've pondered on Drizzle,
and I may use it for a learning-purpose-app, but for now, Prisma is just fine.

I'm using storybook because I like to work on isolated components and because
I think it is a really great documentation solution.

The only think I am learning in this app, but I think is worth the shot and
I think (maybe, tragically wrong) the foundation setup, which I already did is
the steepest part of the learning curve, is tRPC. I understand what it is and
how beneficial it is. I want to use it across my projects.

I like a lot this mvp starting point, my intention is to build its own repo
and maintain it so it can be used for different ideas I have in mind.

Right of the bat, it has:

- Authentication using next.js app router and a protected sample page.
- A component using shadcn, tailwind 4 with its own storybook story.
- tRPC across all the stack, from client to prisma adapter.
- A page that leverages tRPC and shows a list of users from the database.
- Storybook configured with shadcn and tailwind and the viewoports I use
  (tailwind s,m,l, 2xl and xs[which is a min-width of 375px]).
