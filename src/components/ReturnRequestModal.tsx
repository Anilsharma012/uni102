import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type Order = {
  _id: string;
  items: any[];
  status: string;
};

interface ReturnRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onSuccess?: () => void;
}

export function ReturnRequestModal({
  open,
  onOpenChange,
  order,
  onSuccess,
}: ReturnRequestModalProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a reason for return',
        variant: 'destructive',
      });
      return;
    }

    if (!order) {
      toast({
        title: 'Error',
        description: 'Order information is missing',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { ok, json } = await api(`/api/orders/${order._id}/request-return`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });

      if (ok) {
        toast({
          title: 'Success',
          description: 'Return request submitted successfully. We will review it shortly.',
        });
        setReason('');
        onOpenChange(false);
        onSuccess?.();
      } else {
        toast({
          title: 'Error',
          description: json?.message || 'Failed to submit return request',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Return request error:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit return request',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request Return</DialogTitle>
          <DialogDescription>
            Please provide a reason for returning this order. Our team will review your request and get back to you within 24 hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Reason for Return
            </label>
            <Textarea
              placeholder="Please tell us why you'd like to return this order (e.g., wrong size, damaged, defective quality, etc.)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              className="min-h-32"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Request'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
