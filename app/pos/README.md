# app/pos

The cashier's main order-taking screen. Menu grid, cart, modifiers, table /
order-type assignment — still to come in **Part 16**.

`settle/[orderId]/` is built already (**Part 10**): the payment screen for
an existing order — split payments across methods, each taxed at its own
rate, discount/void with manager approval via
`components/pos/manager-auth-dialog.tsx`. Part 16 will link to it once the
cart screen exists to link *from*.
