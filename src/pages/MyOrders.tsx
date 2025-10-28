import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Package, ArrowRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface OrderItem {
  id: string;
  title: string;
  price: number;
  qty: number;
  image: string;
}

interface Order {
  _id: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  paymentMethod: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  status: string;
  createdAt: string;
  trackingNumber?: string;
  returnReason?: string;
  returnStatus?: string;
}

const MyOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const { ok, json } = await api('/api/orders/mine');

      if (ok && json?.data) {
        setOrders(Array.isArray(json.data) ? json.data : []);
      } else {
        toast.error('Failed to load orders');
      }
    } catch (error) {
      console.error('Fetch orders error:', error);
      toast.error('Failed to load your orders');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReturn = async () => {
    if (!selectedOrderId || !returnReason.trim()) {
      toast.error('Please provide a reason for return');
      return;
    }

    try {
      setSubmitting(true);
      const { ok, json } = await api(`/api/orders/${selectedOrderId}/request-return`, {
        method: 'POST',
        body: JSON.stringify({ reason: returnReason.trim() }),
      });

      if (ok) {
        toast.success('Return request submitted successfully!');
        setReturnReason('');
        setReturnDialogOpen(false);
        setSelectedOrderId(null);
        
        // Update order status in local state
        setOrders((prev) =>
          prev.map((order) =>
            order._id === selectedOrderId
              ? { ...order, returnStatus: 'Pending', returnReason: returnReason.trim() }
              : order
          )
        );
      } else {
        toast.error(json?.message || 'Failed to submit return request');
      }
    } catch (error) {
      console.error('Return request error:', error);
      toast.error('Failed to submit return request');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-blue-100 text-blue-800',
    shipped: 'bg-purple-100 text-purple-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  const returnStatusColors = {
    None: 'bg-gray-100 text-gray-800',
    Pending: 'bg-yellow-100 text-yellow-800',
    Approved: 'bg-green-100 text-green-800',
    Rejected: 'bg-red-100 text-red-800',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 pt-24 pb-12">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">
            My <span className="text-primary">Orders</span>
          </h1>
          <p className="text-lg text-muted-foreground">Track and manage all your orders in one place</p>
        </div>

        {orders.length === 0 ? (
          <Card className="bg-white rounded-xl shadow-sm border-0">
            <CardContent className="py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-lg text-muted-foreground mb-4">You haven't placed any orders yet</p>
              <Link to="/shop">
                <Button>Start Shopping</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <Card key={order._id} className="bg-white rounded-xl shadow-sm border-0 hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-6">
                    {/* Order Info */}
                    <div className="lg:col-span-3 space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Order ID</p>
                        <p className="font-semibold text-sm">{order._id.substring(0, 12).toUpperCase()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Date</p>
                        <p className="font-semibold text-sm">{new Date(order.createdAt).toLocaleDateString('en-IN')}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
                        <p className="font-bold text-lg text-primary">₹{order.total.toLocaleString('en-IN')}</p>
                      </div>
                    </div>

                    {/* Items Summary */}
                    <div className="lg:col-span-4 space-y-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Items ({order.items.length})</p>
                      <div className="space-y-1">
                        {order.items.slice(0, 2).map((item) => (
                          <p key={item.id} className="text-sm text-muted-foreground truncate">
                            {item.title} (×{item.qty})
                          </p>
                        ))}
                        {order.items.length > 2 && (
                          <p className="text-sm text-muted-foreground">+{order.items.length - 2} more items</p>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="lg:col-span-2 space-y-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
                      <div className="flex flex-col gap-2">
                        <Badge
                          className={statusColors[order.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}
                        >
                          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                        </Badge>
                        {order.returnStatus && order.returnStatus !== 'None' && (
                          <Badge
                            variant="outline"
                            className={returnStatusColors[order.returnStatus as keyof typeof returnStatusColors] || ''}
                          >
                            Return: {order.returnStatus}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="lg:col-span-3 flex flex-col gap-2">
                      <Link to={`/order-success?orderId=${order._id}`}>
                        <Button variant="outline" size="sm" className="w-full text-xs">
                          View Details
                        </Button>
                      </Link>

                      {order.status === 'delivered' && (!order.returnStatus || order.returnStatus === 'None' || order.returnStatus === 'Rejected') ? (
                        <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="w-full text-xs"
                              onClick={() => setSelectedOrderId(order._id)}
                            >
                              Request Return
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[500px]">
                            <DialogHeader>
                              <DialogTitle>Request Return</DialogTitle>
                              <DialogDescription>
                                Please provide a reason for your return request. Our team will review it and get back to you within 24 hours.
                              </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4 py-4">
                              <div>
                                <p className="text-sm font-semibold mb-2">Order: {order._id.substring(0, 12).toUpperCase()}</p>
                                <div className="bg-muted rounded-lg p-3 mb-4">
                                  {order.items.map((item) => (
                                    <p key={item.id} className="text-sm text-muted-foreground">
                                      {item.title} (×{item.qty})
                                    </p>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="reason">Reason for Return *</Label>
                                <Textarea
                                  id="reason"
                                  placeholder="Please describe why you want to return this order (e.g., Damaged, Wrong item, Size doesn't fit, Changed mind, etc.)"
                                  value={returnReason}
                                  onChange={(e) => setReturnReason(e.target.value)}
                                  rows={4}
                                  disabled={submitting}
                                  className="text-sm"
                                />
                              </div>

                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
                                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-blue-800">
                                  Once approved, we'll arrange a free pickup from your address and process a full refund within 5-7 days.
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setReturnDialogOpen(false);
                                  setReturnReason('');
                                  setSelectedOrderId(null);
                                }}
                                disabled={submitting}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={handleRequestReturn}
                                disabled={submitting || !returnReason.trim()}
                                className="flex items-center gap-2"
                              >
                                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                Submit Request
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      ) : order.returnStatus === 'Pending' ? (
                        <Button size="sm" variant="secondary" disabled className="w-full text-xs">
                          Return Pending
                        </Button>
                      ) : order.returnStatus === 'Approved' ? (
                        <Button size="sm" variant="secondary" disabled className="w-full text-xs bg-green-100 text-green-800">
                          Return Approved
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default MyOrders;
