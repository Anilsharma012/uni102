import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { CheckoutModal } from "@/components/CheckoutModal";

const Cart = () => {
  const { items, total, updateQty, removeItem } = useCart();
  const { toast } = useToast();
  const [openCheckout, setOpenCheckout] = useState(false);

  const handleDecrease = (id: string, qty: number) => {
    if (qty <= 1) return;
    updateQty(id, qty - 1);
  };
  const handleIncrease = (id: string, qty: number) => updateQty(id, qty + 1);
  const handleRemove = (id: string) => {
    removeItem(id);
    toast({ title: "Removed from cart" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 pt-24 pb-12">
        <Link to="/shop" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Continue Shopping
        </Link>

        <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-12">
          Shopping <span className="text-primary">Cart</span>
        </h1>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-xl text-muted-foreground mb-8">Your cart is empty</p>
            <Link to="/shop">
              <Button size="lg">Start Shopping</Button>
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <Card key={item.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {item.image && <img src={item.image} alt={item.title} className="w-20 h-20 object-cover rounded" />}
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      {item.meta?.size && <p className="text-sm text-muted-foreground">Size: {item.meta.size}</p>}
                      <p className="font-bold mt-1">₹{(item.price || 0).toLocaleString("en-IN")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center border border-border rounded">
                      <button className="px-3 py-1" onClick={() => handleDecrease(item.id, item.qty)}>-</button>
                      <div className="px-3 py-1">{item.qty}</div>
                      <button className="px-3 py-1" onClick={() => handleIncrease(item.id, item.qty)}>+</button>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">₹{(item.qty * item.price).toLocaleString("en-IN")}</div>
                      <button className="text-sm text-destructive mt-1 inline-flex items-center gap-1" onClick={() => handleRemove(item.id)}>
                        <Trash2 className="w-4 h-4" /> Remove
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Order Summary */}
            <div>
              <Card className="p-6 sticky top-24">
                <h2 className="text-xl font-bold mb-6">Order Summary</h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-semibold">₹{total.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="font-semibold">Free</span>
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold text-lg">₹{total.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>

                <Button className="w-full" size="lg" onClick={() => setOpenCheckout(true)}>
                  Proceed to Checkout
                </Button>
              </Card>
            </div>
          </div>
        )}
      </main>

      <Footer />

      <CheckoutModal open={openCheckout} setOpen={setOpenCheckout} />
    </div>
  );
};

export default Cart;
