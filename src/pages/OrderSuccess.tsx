import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Download, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type OrderItem = {
  id: string;
  title: string;
  price: number;
  qty: number;
  image?: string;
  size?: string;
};

type OrderData = {
  _id: string;
  name: string;
  email?: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  status: string;
  paymentMethod: string;
  createdAt: string;
  trackingNumber?: string;
};

export default function OrderSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    const loadOrder = async () => {
      try {
        // Extract order ID from URL params or location state
        const params = new URLSearchParams(location.search);
        const orderId = params.get('id') || (location.state as any)?.orderId;

        if (!orderId) {
          toast({
            title: 'Order Not Found',
            description: 'No order ID provided',
            variant: 'destructive',
          });
          navigate('/dashboard');
          return;
        }

        const { ok, json } = await api(`/api/orders/${orderId}`);
        if (ok && json?.data) {
          setOrder(json.data);
          
          // Auto-send confirmation email if not already sent
          if (json.data.status === 'paid' || json.data.status === 'pending') {
            await sendConfirmationEmail(orderId);
          }
        } else {
          toast({
            title: 'Error',
            description: 'Failed to load order details',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Failed to load order:', error);
        toast({
          title: 'Error',
          description: 'Failed to load order details',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [location, navigate, toast]);

  const sendConfirmationEmail = async (orderId: string) => {
    try {
      setSendingEmail(true);
      const { ok } = await api(`/api/orders/${orderId}/email`, { method: 'POST' });
      if (ok) {
        toast({
          title: 'Email Sent',
          description: 'Order confirmation email has been sent',
        });
      }
    } catch (error) {
      console.error('Failed to send email:', error);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDownloadInvoice = () => {
    if (!order) return;
    // This would typically generate and download a PDF invoice
    toast({
      title: 'Coming Soon',
      description: 'Invoice download will be available shortly',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your order...</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <Navbar />
        <main className="container mx-auto px-4 pt-24 pb-12 min-h-screen flex items-center justify-center">
          <Card className="p-8 text-center max-w-md">
            <p className="text-gray-600 mb-4">Order not found</p>
            <Button onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div>
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-3xl mx-auto">
          {/* Success Banner */}
          <div className="text-center mb-8">
            <div className="inline-block mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Placed Successfully!</h1>
            <p className="text-gray-600">Thank you for your purchase. Your order is being prepared.</p>
          </div>

          {/* Order Details Card */}
          <Card className="p-6 rounded-xl shadow-sm bg-white mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-1">Order ID</h2>
                <p className="text-2xl font-bold text-gray-900">{order._id.substring(0, 8).toUpperCase()}</p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-1">Order Date</h2>
                <p className="text-lg text-gray-900">{new Date(order.createdAt).toLocaleDateString('en-IN')}</p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-1">Payment Method</h2>
                <p className="text-lg text-gray-900">{order.paymentMethod || 'Not specified'}</p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-1">Status</h2>
                <div className="inline-block">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    order.status === 'paid' || order.status === 'pending'
                      ? 'bg-blue-100 text-blue-700'
                      : order.status === 'shipped'
                      ? 'bg-yellow-100 text-yellow-700'
                      : order.status === 'delivered'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Order Items */}
          <Card className="p-6 rounded-xl shadow-sm bg-white mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Order Items
            </h2>
            <div className="space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-start gap-4 pb-4 border-b border-gray-200 last:border-b-0">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-20 w-20 object-cover rounded-lg bg-gray-100"
                    />
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{item.title}</h3>
                    {item.size && <p className="text-sm text-gray-600">Size: {item.size}</p>}
                    <p className="text-sm text-gray-600">Qty: {item.qty}</p>
                  </div>
                  <p className="font-semibold text-gray-900">₹{(item.price * item.qty).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Order Summary */}
          <Card className="p-6 rounded-xl shadow-sm bg-white mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>₹{order.subtotal.toLocaleString('en-IN')}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>-₹{order.discount.toLocaleString('en-IN')}</span>
                </div>
              )}
              {order.shipping > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Shipping</span>
                  <span>₹{order.shipping.toLocaleString('en-IN')}</span>
                </div>
              )}
              {order.tax > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span>
                  <span>₹{order.tax.toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-blue-600">₹{order.total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </Card>

          {/* Shipping Address */}
          <Card className="p-6 rounded-xl shadow-sm bg-white mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Shipping Address</h2>
            <p className="text-gray-700 mb-2 font-semibold">{order.name}</p>
            <p className="text-gray-600 text-sm">{order.address}</p>
            <p className="text-gray-600 text-sm">
              {order.city}
              {order.city && order.state ? ', ' : ''}
              {order.state} {order.pincode}
            </p>
            <p className="text-gray-600 text-sm mt-3">
              <strong>Phone:</strong> {order.phone}
            </p>
          </Card>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDownloadInvoice}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Invoice
            </Button>
            <Button
              className="flex-1"
              onClick={() => navigate('/dashboard?tab=orders')}
            >
              Back to My Orders
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate('/shop')}
            >
              Continue Shopping
            </Button>
          </div>

          {/* Info Box */}
          <Card className="p-4 rounded-xl bg-blue-50 border border-blue-200 mt-6">
            <p className="text-sm text-blue-800">
              <strong>📧 Order Confirmation:</strong> A confirmation email has been sent to your registered email address. You can track your order status from your dashboard.
            </p>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
