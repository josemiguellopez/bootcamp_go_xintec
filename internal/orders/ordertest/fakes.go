// Package ordertest tiene dobles de prueba (fakes) para los tests del módulo
// de pedidos: un repositorio en memoria y un publicador que guarda los eventos.
package ordertest

import (
	"context"
	"sync"

	"microservice/internal/orders/domain"
)

// MemoryRepo guarda pedidos en un mapa. El mutex hace que Create sea atómico,
// igual que el UNIQUE de PostgreSQL. Err simula una falla de la base.
type MemoryRepo struct {
	mu     sync.Mutex
	orders map[string]*domain.Order
	byKey  map[string]string // idempotency key -> order id
	Err    error
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{orders: map[string]*domain.Order{}, byKey: map[string]string{}}
}

func (r *MemoryRepo) Create(_ context.Context, o *domain.Order, key string) (*domain.Order, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Err != nil {
		return nil, false, r.Err
	}
	if id, used := r.byKey[key]; key != "" && used {
		return r.orders[id], false, nil
	}
	if key != "" {
		r.byKey[key] = o.ID()
	}
	r.orders[o.ID()] = o
	return o, true, nil
}

func (r *MemoryRepo) FindByID(_ context.Context, id string) (*domain.Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Err != nil {
		return nil, r.Err
	}
	o, ok := r.orders[id]
	if !ok {
		return nil, domain.ErrOrderNotFound()
	}
	return o, nil
}

func (r *MemoryRepo) UpdateStatus(_ context.Context, id string, change func(*domain.Order) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, ok := r.orders[id]
	if !ok {
		return domain.ErrOrderNotFound()
	}
	// Trabajamos sobre una copia para que, si change falla, no quede nada a medias.
	c := domain.Rehydrate(o.ID(), o.CustomerID(), o.Items(), o.Status(), o.CreatedAt(), o.UpdatedAt())
	if err := change(c); err != nil {
		return err
	}
	r.orders[id] = c
	return nil
}

// Count devuelve cuántos pedidos hay.
func (r *MemoryRepo) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.orders)
}

// FakePublisher guarda los eventos publicados. Err simula un broker caído.
type FakePublisher struct {
	mu     sync.Mutex
	Events []domain.OrderCreated
	Err    error
}

func (p *FakePublisher) PublishOrderCreated(ctx context.Context, e domain.OrderCreated) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.Err != nil {
		return p.Err
	}
	if err := ctx.Err(); err != nil { // como el real: con el contexto cancelado no publica
		return err
	}
	p.Events = append(p.Events, e)
	return nil
}

func (p *FakePublisher) Count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.Events)
}
